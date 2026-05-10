/**
 * Hymns At Home - Service Worker
 * Stale-while-revalidate for app shell, cache-as-you-listen for MP3s.
 */

const APP_CACHE = 'hymns-v1';
const MP3_CACHE = 'hymns-mp3-v1';
const MAX_MP3_CACHE = 50;

const APP_SHELL = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/app.js',
  '/manifest.json',
  '/songs/manifest.json',
  '/assets/hero-1.jpg',
  '/assets/hero-2.jpg',
  '/assets/hero-3.jpg',
  '/assets/hero-4.jpg',
];

// Install: pre-cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => {
      return cache.addAll(APP_SHELL);
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

// Activate: delete old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== APP_CACHE && key !== MP3_CACHE)
          .map((key) => caches.delete(key))
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Fetch: route requests
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // MP3 files: cache-first, then network
  if (url.pathname.endsWith('.mp3')) {
    event.respondWith(handleMP3(event.request));
    return;
  }

  // App shell: stale-while-revalidate
  event.respondWith(handleAppShell(event.request));
});

async function handleAppShell(request) {
  const cache = await caches.open(APP_CACHE);
  const cached = await cache.match(request);

  // Fetch in background to update cache
  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) {
      // Check if manifest changed
      if (request.url.includes('songs/manifest.json')) {
        checkManifestUpdate(cached, response.clone());
      }
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => {
    // Network failed, return cached or offline fallback
    return cached;
  });

  // Return cached immediately if available, otherwise wait for network
  return cached || fetchPromise;
}

async function handleMP3(request) {
  const cache = await caches.open(MP3_CACHE);
  const cached = await cache.match(request);

  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      // Cache the MP3 after successful fetch
      await cacheMP3WithEviction(cache, request, response.clone());
    }
    return response;
  } catch (e) {
    // Offline and not cached
    return new Response('This song is not available offline.', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

async function cacheMP3WithEviction(cache, request, response) {
  // Check cache size and evict LRU if needed
  const keys = await cache.keys();
  if (keys.length >= MAX_MP3_CACHE) {
    // Evict oldest entry (first in list)
    await cache.delete(keys[0]);
  }
  await cache.put(request, response);
}

async function checkManifestUpdate(cachedResponse, newResponse) {
  if (!cachedResponse) return;

  try {
    const cachedText = await cachedResponse.clone().text();
    const newText = await newResponse.clone().text();

    if (cachedText !== newText) {
      // Notify all clients
      const clients = await self.clients.matchAll();
      clients.forEach((client) => {
        client.postMessage({ type: 'manifest-updated' });
      });
    }
  } catch (e) {
    // Silent failure
  }
}
