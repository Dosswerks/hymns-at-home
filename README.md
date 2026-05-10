# Hymns At Home

A personal piano music jukebox for the family. Built as a static single-page application — no frameworks, no build step, no server. Deploys to GitHub Pages.

## Features

- **Song library** loaded from a JSON manifest with genre filtering, search, and sort
- **Audio playback** with queue management, shuffle, loop, and timed playback mode
- **iOS-aware audio engine** — skips Web Audio API routing on iOS/iPadOS to preserve background and lock-screen playback
- **Media Session API** — play/pause/skip from the lock screen and Control Center
- **Saved playlists** persisted to localStorage
- **Offline support** via service worker (stale-while-revalidate for app shell, cache-as-you-listen for MP3s)
- **Responsive layout** optimized for phones, tablets, and desktop
- **Hero slideshow** — cycles through photos with a crossfade every 10 seconds
- **Accessible** — keyboard navigation, ARIA labels, focus management, respects prefers-reduced-motion

## Getting Started

### Adding Songs

Drop MP3 files into genre subfolders under `songs/`:

```
songs/
  christmas/
    O-Holy-Night.mp3
    Silent-Night.mp3
  gospel/
    Amazing-Grace.mp3
  formal-hymns/
    Be-Thou-My-Vision.mp3
```

- Folder names become genre labels (dashes/underscores → spaces, title case)
- Filenames become song titles (dashes/underscores → spaces, title case)
- Create as many genre folders as you like

### Generating the Manifest

After adding or removing MP3 files, rebuild the manifest:

```bash
node scripts/generate-manifest.js
```

This scans `songs/` and writes `songs/manifest.json`.

### Local Development

Serve the project with any static file server:

```bash
npx serve .
```

Then open `http://localhost:3000`. A local server is required for the service worker and audio playback to function correctly.

### Deploying to GitHub Pages

1. Push to GitHub
2. Go to Settings → Pages → Source: "Deploy from a branch" → Branch: `main`, folder: `/ (root)`
3. The site will be live at `https://your-username.github.io/hymns-at-home/`

## Project Structure

```
hymns-at-home/
├── index.html              # Single-page application
├── manifest.json           # PWA web app manifest
├── sw.js                   # Service worker
├── css/
│   └── styles.css          # All styles (warm browns, golden tones)
├── js/
│   └── app.js              # All application logic
├── assets/
│   ├── hero-1.jpg          # Hero slideshow images (4:3 aspect ratio)
│   ├── hero-2.jpg
│   ├── hero-3.jpg
│   ├── hero-4.jpg
│   └── hah-logo.png        # Site logo overlay
├── songs/
│   ├── manifest.json       # Auto-generated song manifest
│   ├── christmas/          # Genre folders with MP3 files
│   ├── gospel/
│   └── formal-hymns/
└── scripts/
    └── generate-manifest.js  # Manifest generation script
```

## Technical Notes

### iOS Audio Handling

The audio engine proactively detects iOS/iPadOS and uses a plain `HTMLAudioElement` path instead of routing through `AudioContext`. This prevents audio from stopping when the screen locks. Additional iOS considerations:

- No prefetch of extra Audio elements (disrupts the active audio session)
- Single audio element only (no crossfade on iOS)
- `AbortError` on `play()` is caught and ignored (normal on rapid track changes)
- Volume controlled via `HTMLAudioElement.volume` instead of GainNode

### Service Worker Caching

- **App shell**: stale-while-revalidate (serves cached version immediately, updates in background)
- **MP3 files**: cache-as-you-listen with a 50-song LRU cap
- **Manifest updates**: detected via background revalidation, notifies the app to refresh

### Data Storage

All user data stays in the browser via localStorage (prefixed `hymns_`):

- Saved playlists
- Playback state (queue, volume, shuffle, loop)
- Preferences (genre filter, sort order)
- Recently played history

Use `?reset` in the URL or the "Reset saved data" link in the footer to clear all saved data.

## Browser Support

- Chrome, Safari, Firefox, Edge (latest 2 versions)
- iOS Safari and Android Chrome
- Works offline after first visit (for previously played songs)

## License

Personal project. Not licensed for redistribution.
