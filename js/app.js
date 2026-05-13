/**
 * Hymns At Home - Main Application
 * A personal piano music jukebox for the family.
 * Vanilla JS, no dependencies, no build step.
 */

// ============================================================
// UTILITY: Time Formatting
// ============================================================

function formatTime(seconds) {
  if (!seconds || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// ============================================================
// MODULE: SearchModule (pure functions)
// ============================================================

function filterByGenre(songs, genre) {
  if (!genre) return songs;
  return songs.filter(s => s.genre === genre);
}

function filterBySearch(songs, query) {
  if (!query || !query.trim()) return songs;
  const q = query.trim().toLowerCase();
  return songs.filter(s => s.title.toLowerCase().includes(q));
}

function sortSongs(songs, order, recentList) {
  const sorted = [...songs];
  switch (order) {
    case 'az':
      sorted.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case 'za':
      sorted.sort((a, b) => b.title.localeCompare(a.title));
      break;
    case 'recent':
      if (recentList && recentList.length > 0) {
        const recentMap = new Map();
        recentList.forEach((entry, i) => recentMap.set(entry.songId, i));
        sorted.sort((a, b) => {
          const aIdx = recentMap.has(a.id) ? recentMap.get(a.id) : Infinity;
          const bIdx = recentMap.has(b.id) ? recentMap.get(b.id) : Infinity;
          return aIdx - bIdx;
        });
      }
      break;
  }
  return sorted;
}

function applyAllFilters(songs, genre, query, order, recentList) {
  let result = filterByGenre(songs, genre);
  result = filterBySearch(result, query);
  result = sortSongs(result, order, recentList);
  return result;
}


// ============================================================
// MODULE: Hero Slideshow
// ============================================================

function initHeroSlideshow() {
  const images = document.querySelectorAll('.hero__image');
  if (images.length <= 1) return;

  let currentIndex = 0;
  const intervalMs = 10000; // 10 seconds

  // Respect prefers-reduced-motion
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (motionQuery.matches) return;

  const advance = () => {
    images[currentIndex].classList.remove('hero__image--active');
    currentIndex = (currentIndex + 1) % images.length;
    images[currentIndex].classList.add('hero__image--active');
  };

  let timer = setInterval(advance, intervalMs);

  // Pause when tab is hidden to avoid jarring jump on return
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearInterval(timer);
    } else {
      timer = setInterval(advance, intervalMs);
    }
  });

  // Stop if user prefers reduced motion mid-session
  motionQuery.addEventListener('change', (e) => {
    if (e.matches) {
      clearInterval(timer);
    } else {
      timer = setInterval(advance, intervalMs);
    }
  });
}

// ============================================================
// MODULE: StorageManager
// ============================================================

const STORAGE_PREFIX = 'hymns_';
const CURRENT_VERSION = 1;

const StorageManager = {
  isAvailable() {
    try {
      const key = '__hymns_test__';
      localStorage.setItem(key, '1');
      localStorage.removeItem(key);
      return true;
    } catch (e) {
      return false;
    }
  },

  _get(key) {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error(`[StorageManager] Failed to read ${key}:`, e);
      return null;
    }
  },

  _set(key, value) {
    try {
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error(`[StorageManager] Failed to write ${key}:`, e);
      return false;
    }
  },

  loadState() {
    if (!this.isAvailable()) return null;
    const version = this._get('version');
    if (version && version < CURRENT_VERSION) {
      // Run migrations if needed in the future
      this._set('version', CURRENT_VERSION);
    } else if (!version) {
      this._set('version', CURRENT_VERSION);
    }
    return {
      playlists: this._get('playlists') || [],
      playback: this._get('playback') || null,
      preferences: this._get('preferences') || { genreFilter: null, sortOrder: 'az', volume: 1.0 },
      recent: this._get('recent') || [],
    };
  },

  savePlaybackState(state) {
    this._set('playback', state);
  },

  savePlaylists(playlists) {
    this._set('playlists', playlists);
  },

  savePreferences(prefs) {
    this._set('preferences', prefs);
  },

  loadRecentlyPlayed() {
    return this._get('recent') || [];
  },

  saveRecentlyPlayed(recent) {
    this._set('recent', recent);
  },

  resetAll() {
    if (!this.isAvailable()) return;
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) {
        keys.push(key);
      }
    }
    keys.forEach(k => localStorage.removeItem(k));
  }
};


// ============================================================
// MODULE: AudioEngine
// ============================================================

class AudioEngine {
  constructor() {
    this._audio = new Audio();
    this._audio.preload = 'none';
    this._prefetchAudio = null;

    this._context = null;
    this._gainNode = null;
    this._sourceNode = null;
    this._webAudioConnected = false;
    this._webAudioAvailable = false;
    this._isIOS = false;

    this._volume = 1.0;
    this._status = 'stopped'; // stopped | playing | paused | buffering
    this._currentSong = null;
    this._retryTimeout = null;
    this._retryAbort = null;

    this._listeners = {};

    this._detectPlatform();
    this._initWebAudio();
    this._setupAudioEvents();
  }

  _detectPlatform() {
    this._isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  _initWebAudio() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this._context = new AudioCtx();
        this._gainNode = this._context.createGain();
        this._gainNode.connect(this._context.destination);
        this._webAudioAvailable = true;
      }
    } catch (e) {
      this._webAudioAvailable = false;
    }
  }

  /**
   * Returns false on iOS/iPadOS to preserve background playback.
   * Routing through AudioContext causes audio to stop on screen lock.
   */
  shouldRouteAudio() {
    if (!this._webAudioAvailable) return false;
    return !this._isIOS;
  }

  /**
   * Unlock AudioContext on first user interaction.
   */
  init() {
    if (this._context && this._context.state === 'suspended') {
      this._context.resume().catch(() => {});
    }
  }

  play(song) {
    if (!song) return;

    this._cancelRetry();
    this._currentSong = song;
    this._status = 'buffering';
    this._emit('buffering');

    this._audio.src = song.path;
    this._audio.preload = 'auto';
    this._audio.load();

    // Connect to Web Audio on first play (skip on iOS)
    if (!this._webAudioConnected && this.shouldRouteAudio()) {
      try {
        this._sourceNode = this._context.createMediaElementSource(this._audio);
        this._sourceNode.connect(this._gainNode);
        this._webAudioConnected = true;
      } catch (e) {
        // Already connected or failed — use fallback
      }
    }

    this._applyVolume();

    const playPromise = this._audio.play();
    if (playPromise) {
      playPromise.catch((err) => {
        if (err.name !== 'AbortError') {
          this._handlePlayError(song);
        }
      });
    }

    // Media Session API
    this._updateMediaSession(song);
  }

  pause() {
    if (this._status !== 'playing' && this._status !== 'buffering') return;
    this._audio.pause();
    this._status = 'paused';
    this._emit('playbackPaused');
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'paused';
    }
  }

  resume() {
    if (this._status !== 'paused') return;
    const playPromise = this._audio.play();
    if (playPromise) {
      playPromise.catch(() => {});
    }
  }

  stop() {
    this._cancelRetry();
    this._audio.pause();
    this._audio.currentTime = 0;
    this._audio.src = '';
    this._status = 'stopped';
    this._currentSong = null;
    this._cancelPrefetch();
    this._emit('songEnded');
  }

  seek(seconds) {
    if (!this._audio.duration) return;
    this._audio.currentTime = Math.max(0, Math.min(seconds, this._audio.duration));
  }

  seekFraction(fraction) {
    if (!this._audio.duration) return;
    this._audio.currentTime = fraction * this._audio.duration;
  }

  setVolume(level) {
    this._volume = Math.max(0, Math.min(1, level));
    this._applyVolume();
  }

  interrupt() {
    this._cancelRetry();
    this._audio.pause();
    this._audio.currentTime = 0;
    this._cancelPrefetch();
  }

  preloadNext(song) {
    // Skip prefetch on iOS — extra Audio elements disrupt the active audio session
    if (this._isIOS || !song) return;
    this._cancelPrefetch();
    this._prefetchAudio = new Audio();
    this._prefetchAudio.preload = 'metadata';
    this._prefetchAudio.src = song.path;
  }

  getElapsed() {
    return this._audio.currentTime || 0;
  }

  getDuration() {
    return this._audio.duration || 0;
  }

  getStatus() {
    return this._status;
  }

  getCurrentSong() {
    return this._currentSong;
  }

  destroy() {
    this._cancelRetry();
    this._cancelPrefetch();
    this._audio.pause();
    this._audio.src = '';
    this._removeAudioEvents();
    if (this._sourceNode) {
      try { this._sourceNode.disconnect(); } catch (e) {}
    }
    if (this._gainNode) {
      try { this._gainNode.disconnect(); } catch (e) {}
    }
    if (this._context && this._context.state !== 'closed') {
      this._context.close().catch(() => {});
    }
  }

  // --- Events ---

  on(event, handler) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(handler);
  }

  _emit(event, data) {
    const handlers = this._listeners[event];
    if (handlers) handlers.forEach(h => h(data));
  }

  // --- Private ---

  _applyVolume() {
    if (this._webAudioConnected) {
      this._gainNode.gain.value = this._volume;
    } else {
      this._audio.volume = this._volume;
    }
  }

  _setupAudioEvents() {
    this._audio.addEventListener('playing', () => {
      this._status = 'playing';
      this._emit('songStarted', this._currentSong);
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
      }
    });

    this._audio.addEventListener('pause', () => {
      if (this._status === 'playing') {
        this._status = 'paused';
        this._emit('playbackPaused');
      }
    });

    this._audio.addEventListener('waiting', () => {
      this._emit('buffering');
    });

    this._audio.addEventListener('canplay', () => {
      this._emit('bufferingEnd');
    });

    this._audio.addEventListener('timeupdate', () => {
      this._emit('timeUpdate', {
        elapsed: this._audio.currentTime,
        duration: this._audio.duration || 0,
      });
    });

    this._audio.addEventListener('ended', () => {
      this._status = 'stopped';
      this._emit('songEnded', this._currentSong);
    });

    this._audio.addEventListener('error', () => {
      this._handlePlayError(this._currentSong);
    });
  }

  _removeAudioEvents() {
    // Clone node to remove all listeners
    const newAudio = this._audio.cloneNode(false);
    this._audio = newAudio;
  }

  _handlePlayError(song) {
    // Retry once after 2 seconds
    this._retryAbort = new AbortController();
    this._retryTimeout = setTimeout(() => {
      if (this._retryAbort && this._retryAbort.signal.aborted) return;
      // Retry
      this._audio.load();
      const retryPromise = this._audio.play();
      if (retryPromise) {
        retryPromise.catch(() => {
          // Retry failed — emit error
          this._status = 'stopped';
          this._emit('songError', song);
        });
      }
    }, 2000);
  }

  _cancelRetry() {
    if (this._retryTimeout) {
      clearTimeout(this._retryTimeout);
      this._retryTimeout = null;
    }
    if (this._retryAbort) {
      this._retryAbort.abort();
      this._retryAbort = null;
    }
  }

  _cancelPrefetch() {
    if (this._prefetchAudio) {
      this._prefetchAudio.src = '';
      this._prefetchAudio = null;
    }
  }

  _updateMediaSession(song) {
    if (!('mediaSession' in navigator) || !song) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title,
      artist: 'Andrew Doss',
      album: song.genre,
    });
    navigator.mediaSession.playbackState = 'playing';
  }
}


// ============================================================
// MODULE: AppState & Dispatch
// ============================================================

const AppState = {
  library: [],
  filteredSongs: [],
  genres: [],
  queue: {
    songs: [],
    shuffledOrder: null,
    currentIndex: -1,
    source: 'library',
  },
  playback: {
    status: 'stopped',
    currentSongId: null,
    elapsed: 0,
    duration: 0,
    volume: 1.0,
    shuffle: false,
    loop: false,
    timedMode: null,
  },
  playlists: [],
  ui: {
    genreFilter: null,
    searchQuery: '',
    sortOrder: 'az',
    selectedSongIds: new Set(),
  },
  recentlyPlayed: [],
  storageAvailable: false,
};

// Debounce utility
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// Shuffle utility (Fisher-Yates)
function shuffleArray(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Generate unique ID
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ============================================================
// MODULE: Application Controller
// ============================================================

class HymnsApp {
  constructor() {
    this.audio = new AudioEngine();
    this.state = AppState;
    this._saveDebounced = debounce(() => this._persistPlaybackState(), 800);
    this._timerInterval = null;
  }

  async init() {
    console.log('[HymnsApp] Initializing...');

    // Check for ?reset parameter
    if (window.location.search.includes('reset')) {
      if (confirm('This will clear all your saved playlists and preferences. Continue?')) {
        StorageManager.resetAll();
        window.location.href = window.location.pathname;
        return;
      }
    }

    // Check localStorage
    this.state.storageAvailable = StorageManager.isAvailable();

    // Load saved state
    if (this.state.storageAvailable) {
      const saved = StorageManager.loadState();
      if (saved) {
        this.state.playlists = saved.playlists || [];
        this.state.recentlyPlayed = saved.recent || [];
        if (saved.preferences) {
          this.state.ui.genreFilter = saved.preferences.genreFilter;
          this.state.ui.sortOrder = saved.preferences.sortOrder || 'az';
          this.state.playback.volume = (saved.preferences.volume != null) ? saved.preferences.volume : 1.0;
        }
        if (saved.playback) {
          this.state.playback.shuffle = saved.playback.shuffle || false;
          this.state.playback.loop = saved.playback.loop || false;
        }
      }
    }

    // Set volume on audio engine
    this.audio.setVolume(this.state.playback.volume);

    // Load manifest
    try {
      const response = await fetch('songs/manifest.json');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      this._loadManifest(data);
    } catch (e) {
      console.error('[HymnsApp] Failed to load manifest:', e);
      this._showError("Couldn't load the song library. Please check your connection and refresh.");
      return;
    }

    // Set up UI
    this._renderGenreFilter();
    this._applyFilters();
    this._renderSongList();
    this._renderPlaylists();
    this._restorePlaybackState();
    this._bindEvents();
    this._setupMediaSession();

    // Register service worker
    this._registerServiceWorker();

    // Start hero slideshow
    initHeroSlideshow();

    console.log('[HymnsApp] Ready. Library:', this.state.library.length, 'songs');
  }

  // --- Manifest Loading ---

  _loadManifest(data) {
    // Validate manifest
    const songs = data.songs || data;
    if (!Array.isArray(songs)) {
      throw new Error('Invalid manifest format');
    }

    this.state.library = songs.filter(s => {
      if (!s.id || !s.title || !s.genre || !s.path) {
        console.warn('[HymnsApp] Skipping invalid song entry:', s);
        return false;
      }
      return true;
    });

    // Extract genres
    const genreSet = new Set(this.state.library.map(s => s.genre));
    this.state.genres = [...genreSet].sort();
  }

  // --- Filtering ---

  _applyFilters() {
    this.state.filteredSongs = applyAllFilters(
      this.state.library,
      this.state.ui.genreFilter,
      this.state.ui.searchQuery,
      this.state.ui.sortOrder,
      this.state.recentlyPlayed
    );
  }

  // --- Queue Management ---

  _playFromSongList(song) {
    // Replace queue with all visible songs, starting from clicked song
    this.state.queue.songs = [...this.state.filteredSongs];
    this.state.queue.source = 'library';
    const idx = this.state.queue.songs.findIndex(s => s.id === song.id);
    this.state.queue.currentIndex = idx >= 0 ? idx : 0;

    if (this.state.playback.shuffle) {
      this._generateShuffledOrder(idx);
    } else {
      this.state.queue.shuffledOrder = null;
    }

    this._playCurrent();
  }

  _playAll() {
    if (this.state.filteredSongs.length === 0) return;

    this.state.queue.songs = [...this.state.filteredSongs];
    this.state.queue.source = 'library';
    this.state.queue.currentIndex = 0;

    if (this.state.playback.shuffle) {
      this._generateShuffledOrder(0);
    } else {
      this.state.queue.shuffledOrder = null;
    }

    this._playCurrent();
  }

  _playSelected() {
    const selected = this.state.filteredSongs.filter(
      s => this.state.ui.selectedSongIds.has(s.id)
    );
    if (selected.length === 0) return;

    this.state.queue.songs = selected;
    this.state.queue.source = 'selection';
    this.state.queue.currentIndex = 0;

    if (this.state.playback.shuffle) {
      this._generateShuffledOrder(0);
    } else {
      this.state.queue.shuffledOrder = null;
    }

    this._playCurrent();
    this.state.ui.selectedSongIds.clear();
    this._renderSongList();
    this._updateSelectionButtons();
  }

  _addToQueue() {
    const selected = this.state.filteredSongs.filter(
      s => this.state.ui.selectedSongIds.has(s.id)
    );
    if (selected.length === 0) return;

    this.state.queue.songs.push(...selected);

    // If shuffle is on, add to shuffled order at random unplayed positions
    if (this.state.queue.shuffledOrder) {
      const currentPos = this.state.queue.shuffledOrder.indexOf(this.state.queue.currentIndex);
      selected.forEach((_, i) => {
        const newIdx = this.state.queue.songs.length - selected.length + i;
        const insertPos = currentPos + 1 + Math.floor(Math.random() * (this.state.queue.shuffledOrder.length - currentPos));
        this.state.queue.shuffledOrder.splice(insertPos, 0, newIdx);
      });
    }

    this.state.ui.selectedSongIds.clear();
    this._renderSongList();
    this._updateSelectionButtons();
    this._announce(`Added ${selected.length} song${selected.length > 1 ? 's' : ''} to queue`);
  }

  _loadPlaylist(playlist) {
    // Reconcile with current library
    const validSongs = [];
    const missingSongs = [];

    playlist.songIds.forEach(id => {
      const song = this.state.library.find(s => s.id === id);
      if (song) {
        validSongs.push(song);
      } else {
        missingSongs.push(id);
      }
    });

    if (missingSongs.length > 0 && validSongs.length > 0) {
      this._announce(`Some songs in this playlist are no longer available. Playing the rest.`);
    }

    if (validSongs.length === 0) {
      this._announce('This playlist is empty — the songs are no longer available.');
      return;
    }

    // Cancel timed playback if active
    this._stopTimedPlayback();

    this.state.queue.songs = validSongs;
    this.state.queue.source = 'playlist';
    this.state.queue.currentIndex = 0;

    if (this.state.playback.shuffle) {
      this._generateShuffledOrder(0);
    } else {
      this.state.queue.shuffledOrder = null;
    }

    this._playCurrent();
  }

  _playCurrent() {
    let idx = this.state.queue.currentIndex;
    if (this.state.queue.shuffledOrder) {
      idx = (this.state.queue.shuffledOrder[idx] != null) ? this.state.queue.shuffledOrder[idx] : idx;
    }

    const song = this.state.queue.songs[idx];
    if (!song) {
      this.audio.stop();
      this.state.playback.status = 'stopped';
      this._updatePlayerUI();
      return;
    }

    this.audio.init(); // Unlock AudioContext
    this.audio.play(song);
    this.state.playback.currentSongId = song.id;
    this.state.playback.status = 'playing';
    this._updatePlayerUI();
    this._saveDebounced();

    // Preload next
    this._preloadNext();
  }

  _skipForward() {
    if (this.state.queue.songs.length === 0) return;

    const maxIdx = this.state.queue.songs.length - 1;
    let nextIndex = this.state.queue.currentIndex + 1;

    if (nextIndex > maxIdx) {
      if (this.state.playback.loop) {
        nextIndex = 0;
        if (this.state.queue.shuffledOrder) {
          this._generateShuffledOrder(-1);
        }
      } else {
        // End of queue
        this.audio.stop();
        this.state.playback.status = 'stopped';
        this.state.playback.currentSongId = null;
        this._updatePlayerUI();
        this._saveDebounced();
        return;
      }
    }

    this.state.queue.currentIndex = nextIndex;
    this._playCurrent();
  }

  _skipBack() {
    if (this.state.queue.songs.length === 0) return;

    // If more than 3 seconds in, restart current
    if (this.audio.getElapsed() > 3) {
      this.audio.seek(0);
      return;
    }

    let prevIndex = this.state.queue.currentIndex - 1;
    if (prevIndex < 0) {
      prevIndex = this.state.playback.loop ? this.state.queue.songs.length - 1 : 0;
    }

    this.state.queue.currentIndex = prevIndex;
    this._playCurrent();
  }

  _generateShuffledOrder(startIdx) {
    const indices = Array.from({ length: this.state.queue.songs.length }, (_, i) => i);
    const shuffled = shuffleArray(indices);

    // Move startIdx to front if specified
    if (startIdx >= 0) {
      const pos = shuffled.indexOf(startIdx);
      if (pos > 0) {
        shuffled.splice(pos, 1);
        shuffled.unshift(startIdx);
      }
    }

    this.state.queue.shuffledOrder = shuffled;
  }

  _preloadNext() {
    const maxIdx = this.state.queue.songs.length - 1;
    let nextIdx = this.state.queue.currentIndex + 1;
    if (nextIdx > maxIdx) {
      if (this.state.playback.loop) nextIdx = 0;
      else return;
    }

    let actualIdx = nextIdx;
    if (this.state.queue.shuffledOrder) {
      actualIdx = (this.state.queue.shuffledOrder[nextIdx] != null) ? this.state.queue.shuffledOrder[nextIdx] : nextIdx;
    }

    const nextSong = this.state.queue.songs[actualIdx];
    if (nextSong) {
      this.audio.preloadNext(nextSong);
    }
  }

  // --- Shuffle & Loop ---

  _toggleShuffle() {
    this.state.playback.shuffle = !this.state.playback.shuffle;

    if (this.state.playback.shuffle) {
      this._generateShuffledOrder(this.state.queue.currentIndex);
    } else {
      // Restore original order, find current song's position
      if (this.state.queue.shuffledOrder && this.state.queue.currentIndex >= 0) {
        const actualIdx = this.state.queue.shuffledOrder[this.state.queue.currentIndex];
        this.state.queue.currentIndex = (actualIdx != null) ? actualIdx : this.state.queue.currentIndex;
      }
      this.state.queue.shuffledOrder = null;
    }

    this._updateShuffleUI();
    this._saveDebounced();
  }

  _toggleLoop() {
    this.state.playback.loop = !this.state.playback.loop;
    this._updateLoopUI();
    this._saveDebounced();
  }

  // --- Timed Playback ---

  _startTimedPlayback(minutes) {
    this._stopTimedPlayback();

    this.state.playback.timedMode = {
      active: true,
      remainingSeconds: minutes * 60,
    };

    // Build queue from full library (regardless of genre filter)
    this.state.queue.songs = shuffleArray([...this.state.library]);
    this.state.queue.source = 'library';
    this.state.queue.currentIndex = 0;
    this.state.queue.shuffledOrder = null;

    this._playCurrent();

    // Start countdown
    this._timerInterval = setInterval(() => {
      if (!this.state.playback.timedMode) return;
      this.state.playback.timedMode.remainingSeconds--;

      if (this.state.playback.timedMode.remainingSeconds <= 0) {
        // Let current song finish, then stop
        this.state.playback.timedMode.active = false;
        clearInterval(this._timerInterval);
        this._timerInterval = null;
      }

      this._updateTimerUI();
    }, 1000);

    this._updateTimerUI();
  }

  _stopTimedPlayback() {
    if (this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }
    this.state.playback.timedMode = null;
    this._updateTimerUI();
  }

  // --- Playlist CRUD ---

  _createPlaylist(name) {
    const selectedIds = [...this.state.ui.selectedSongIds];
    if (selectedIds.length === 0 && this.state.queue.songs.length > 0) {
      // Save current queue as playlist
      return this._savePlaylistFromQueue(name);
    }

    const trimmedName = (name || 'My Playlist').slice(0, 50);
    const uniqueName = this._getUniqueName(trimmedName);

    const playlist = {
      id: generateId(),
      name: uniqueName,
      songIds: selectedIds,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.state.playlists.push(playlist);
    this._savePlaylists();
    this._renderPlaylists();
    this.state.ui.selectedSongIds.clear();
    this._renderSongList();
    this._updateSelectionButtons();
    this._announce(`Playlist "${uniqueName}" saved`);
  }

  _savePlaylistFromQueue(name) {
    const trimmedName = (name || 'My Playlist').slice(0, 50);
    const uniqueName = this._getUniqueName(trimmedName);

    const playlist = {
      id: generateId(),
      name: uniqueName,
      songIds: this.state.queue.songs.map(s => s.id),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.state.playlists.push(playlist);
    this._savePlaylists();
    this._renderPlaylists();
    this._announce(`Playlist "${uniqueName}" saved`);
  }

  _deletePlaylist(playlistId) {
    this.state.playlists = this.state.playlists.filter(p => p.id !== playlistId);
    this._savePlaylists();
    this._renderPlaylists();
  }

  _renamePlaylist(playlistId, newName) {
    const playlist = this.state.playlists.find(p => p.id === playlistId);
    if (!playlist) return;
    playlist.name = (newName || playlist.name).slice(0, 50);
    playlist.updatedAt = Date.now();
    this._savePlaylists();
    this._renderPlaylists();
  }

  _getUniqueName(name) {
    const existing = this.state.playlists.map(p => p.name);
    if (!existing.includes(name)) return name;
    let counter = 2;
    while (existing.includes(`${name} (${counter})`)) counter++;
    return `${name} (${counter})`;
  }

  _savePlaylists() {
    if (this.state.storageAvailable) {
      StorageManager.savePlaylists(this.state.playlists);
    }
  }

  // --- Recently Played ---

  _addToRecentlyPlayed(song) {
    if (!song) return;
    // Remove existing entry for this song
    this.state.recentlyPlayed = this.state.recentlyPlayed.filter(r => r.songId !== song.id);
    // Add to front
    this.state.recentlyPlayed.unshift({ songId: song.id, timestamp: Date.now() });
    // Keep max 100
    if (this.state.recentlyPlayed.length > 100) {
      this.state.recentlyPlayed = this.state.recentlyPlayed.slice(0, 100);
    }
    if (this.state.storageAvailable) {
      StorageManager.saveRecentlyPlayed(this.state.recentlyPlayed);
    }
  }

  // --- Persistence ---

  _persistPlaybackState() {
    if (!this.state.storageAvailable) return;

    StorageManager.savePlaybackState({
      queueSongIds: this.state.queue.songs.map(s => s.id),
      queueSource: this.state.queue.source,
      currentIndex: this.state.queue.currentIndex,
      shuffle: this.state.playback.shuffle,
      loop: this.state.playback.loop,
    });

    StorageManager.savePreferences({
      genreFilter: this.state.ui.genreFilter,
      sortOrder: this.state.ui.sortOrder,
      volume: this.state.playback.volume,
    });
  }

  _restorePlaybackState() {
    if (!this.state.storageAvailable) return;
    const saved = StorageManager.loadState();
    if (!saved || !saved.playback) return;

    const pb = saved.playback;
    if (pb.queueSongIds && pb.queueSongIds.length > 0) {
      // Rebuild queue from saved IDs
      const songs = pb.queueSongIds
        .map(id => this.state.library.find(s => s.id === id))
        .filter(Boolean);

      if (songs.length > 0) {
        this.state.queue.songs = songs;
        this.state.queue.source = pb.queueSource || 'library';
        this.state.queue.currentIndex = Math.min(pb.currentIndex || 0, songs.length - 1);

        // Show restored state in player
        const currentSong = songs[this.state.queue.currentIndex];
        if (currentSong) {
          this.state.playback.currentSongId = currentSong.id;
          this._showRestoredState(currentSong);
        }
      }
    }
  }

  _showRestoredState(song) {
    const statusEl = document.getElementById('player-status');
    const titleEl = document.getElementById('player-song-title');
    if (statusEl) statusEl.textContent = 'Ready';
    if (titleEl) titleEl.textContent = song.title;
  }

  // --- Service Worker ---

  _registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').then(reg => {
        console.log('[HymnsApp] Service worker registered');

        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                this._announce('A new version is available. Refresh to update.');
              }
            });
          }
        });
      }).catch(err => {
        console.warn('[HymnsApp] Service worker registration failed:', err);
      });

      // Listen for manifest update messages from SW
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'manifest-updated') {
          if (this.state.playback.status !== 'playing') {
            // Silently reload library
            this._reloadManifest();
          } else {
            this._announce('Song library updated. Refresh to see new songs.');
          }
        }
      });
    }
  }

  async _reloadManifest() {
    try {
      const response = await fetch('songs/manifest.json');
      if (!response.ok) return;
      const data = await response.json();
      this._loadManifest(data);
      this._renderGenreFilter();
      this._applyFilters();
      this._renderSongList();
    } catch (e) {
      // Silent failure on background reload
    }
  }

  // --- Media Session ---

  _setupMediaSession() {
    if (!('mediaSession' in navigator)) return;

    navigator.mediaSession.setActionHandler('play', () => {
      if (this.state.playback.status === 'paused') {
        this.audio.resume();
      } else if (this.state.playback.status === 'stopped' && this.state.queue.songs.length > 0) {
        this._playCurrent();
      }
    });

    navigator.mediaSession.setActionHandler('pause', () => {
      this.audio.pause();
    });

    navigator.mediaSession.setActionHandler('previoustrack', () => {
      this._skipBack();
    });

    navigator.mediaSession.setActionHandler('nexttrack', () => {
      this._skipForward();
    });
  }

  // --- Error Display ---

  _showError(message) {
    const container = document.getElementById('song-list-container');
    const emptyEl = document.getElementById('song-list-empty');
    if (container) container.innerHTML = '';
    if (emptyEl) {
      emptyEl.textContent = message;
      emptyEl.hidden = false;
      emptyEl.setAttribute('role', 'alert');
    }
  }

  _announce(message) {
    const el = document.getElementById('sr-announcements');
    if (el) el.textContent = message;
    // Also log for debugging
    console.log('[HymnsApp]', message);
  }


  // ============================================================
  // UI RENDERING
  // ============================================================

  _renderGenreFilter() {
    const container = document.querySelector('.genre-filter');
    if (!container) return;

    container.innerHTML = '';

    // "All" button
    const allBtn = document.createElement('button');
    allBtn.className = 'genre-filter__btn' + (!this.state.ui.genreFilter ? ' genre-filter__btn--active' : '');
    allBtn.textContent = 'All';
    allBtn.setAttribute('aria-pressed', !this.state.ui.genreFilter ? 'true' : 'false');
    allBtn.addEventListener('click', () => this._setGenreFilter(null));
    container.appendChild(allBtn);

    // Genre buttons
    this.state.genres.forEach(genre => {
      const btn = document.createElement('button');
      btn.className = 'genre-filter__btn' + (this.state.ui.genreFilter === genre ? ' genre-filter__btn--active' : '');
      btn.textContent = genre;
      btn.setAttribute('aria-pressed', this.state.ui.genreFilter === genre ? 'true' : 'false');
      btn.addEventListener('click', () => this._setGenreFilter(genre));
      container.appendChild(btn);
    });
  }

  _setGenreFilter(genre) {
    this.state.ui.genreFilter = genre;
    this._applyFilters();
    this._renderGenreFilter();
    this._renderSongList();
    this._saveDebounced();
  }

  _renderSongList() {
    const container = document.getElementById('song-list-container');
    const emptyEl = document.getElementById('song-list-empty');
    if (!container) return;

    container.innerHTML = '';

    if (this.state.filteredSongs.length === 0) {
      if (emptyEl) {
        if (this.state.ui.searchQuery) {
          emptyEl.textContent = 'No songs match your search.';
        } else if (this.state.ui.genreFilter) {
          emptyEl.textContent = 'No songs in this category yet.';
        } else {
          emptyEl.textContent = "No songs available yet. Check back soon — Andrew is recording!";
        }
        emptyEl.hidden = false;
      }
      return;
    }

    if (emptyEl) emptyEl.hidden = true;

    this.state.filteredSongs.forEach(song => {
      const row = document.createElement('div');
      row.className = 'song-row';
      row.setAttribute('role', 'option');
      row.dataset.songId = song.id;

      if (this.state.playback.currentSongId === song.id) {
        row.classList.add('song-row--active');
      }

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'song-row__checkbox';
      checkbox.checked = this.state.ui.selectedSongIds.has(song.id);
      checkbox.setAttribute('aria-label', `Select ${song.title}`);
      checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        if (checkbox.checked) {
          this.state.ui.selectedSongIds.add(song.id);
        } else {
          this.state.ui.selectedSongIds.delete(song.id);
        }
        this._updateSelectionButtons();
      });

      const title = document.createElement('span');
      title.className = 'song-row__title';
      title.textContent = song.title;

      const duration = document.createElement('span');
      duration.className = 'song-row__duration';
      duration.textContent = song.duration ? formatTime(song.duration) : '';

      row.appendChild(checkbox);
      row.appendChild(title);
      row.appendChild(duration);

      // Click row to play (not on checkbox)
      row.addEventListener('click', (e) => {
        if (e.target === checkbox) return;
        this._playFromSongList(song);
      });

      container.appendChild(row);
    });

    // Show total time
    const totalEl = document.getElementById('song-list-total');
    if (totalEl) {
      const totalSeconds = this.state.filteredSongs.reduce((sum, s) => sum + (s.duration || 0), 0);
      const count = this.state.filteredSongs.length;
      totalEl.textContent = `${count} song${count !== 1 ? 's' : ''} · ${formatTime(totalSeconds)}`;
    }
  }

  _renderPlaylists() {
    const container = document.getElementById('playlist-list');
    const emptyEl = document.getElementById('playlist-empty');
    if (!container) return;

    container.innerHTML = '';

    if (this.state.playlists.length === 0) {
      if (emptyEl) emptyEl.hidden = false;
      return;
    }

    if (emptyEl) emptyEl.hidden = true;

    this.state.playlists.forEach(playlist => {
      const entry = document.createElement('div');
      entry.className = 'playlist-entry';

      const header = document.createElement('div');
      header.className = 'playlist-entry__header';
      header.setAttribute('role', 'button');
      header.setAttribute('tabindex', '0');

      const info = document.createElement('div');

      const nameEl = document.createElement('span');
      nameEl.className = 'playlist-entry__name';
      nameEl.textContent = playlist.name;

      const meta = document.createElement('span');
      meta.className = 'playlist-entry__meta';
      const songCount = playlist.songIds.length;
      const totalDuration = playlist.songIds.reduce((sum, id) => {
        const song = this.state.library.find(s => s.id === id);
        return sum + (song ? (song.duration || 0) : 0);
      }, 0);
      meta.textContent = `${songCount} song${songCount !== 1 ? 's' : ''} · ${formatTime(totalDuration)}`;

      info.appendChild(nameEl);
      info.appendChild(document.createElement('br'));
      info.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'playlist-entry__actions';

      const playBtn = document.createElement('button');
      playBtn.className = 'btn btn--small';
      playBtn.textContent = '▶';
      playBtn.setAttribute('aria-label', `Play ${playlist.name}`);
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._loadPlaylist(playlist);
      });

      const editBtn = document.createElement('button');
      editBtn.className = 'btn btn--small';
      editBtn.textContent = '✎';
      editBtn.setAttribute('aria-label', `Edit ${playlist.name}`);
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._renderPlaylistDetail(playlist);
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn btn--small';
      deleteBtn.textContent = '✕';
      deleteBtn.setAttribute('aria-label', `Delete ${playlist.name}`);
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._confirmDeletePlaylist(playlist);
      });

      actions.appendChild(playBtn);
      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);

      header.appendChild(info);
      header.appendChild(actions);

      // Click header to play
      header.addEventListener('click', () => this._loadPlaylist(playlist));
      header.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this._loadPlaylist(playlist);
        }
      });

      entry.appendChild(header);
      container.appendChild(entry);
    });
  }

  _renderPlaylistDetail(playlist) {
    const container = document.getElementById('playlist-list');
    if (!container) return;

    container.innerHTML = '';

    // Back button
    const backBtn = document.createElement('button');
    backBtn.className = 'btn btn--small';
    backBtn.textContent = '← Back';
    backBtn.setAttribute('aria-label', 'Back to playlists');
    backBtn.addEventListener('click', () => this._renderPlaylists());
    container.appendChild(backBtn);

    // Playlist title
    const titleEl = document.createElement('h3');
    titleEl.className = 'playlist-detail__title';
    titleEl.textContent = playlist.name;
    container.appendChild(titleEl);

    // Song list with move up/down
    const list = document.createElement('div');
    list.className = 'playlist-detail__songs';

    playlist.songIds.forEach((songId, index) => {
      const song = this.state.library.find(s => s.id === songId);
      if (!song) return;

      const row = document.createElement('div');
      row.className = 'playlist-detail__row';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'playlist-detail__song-title';
      titleSpan.textContent = song.title;

      const controls = document.createElement('div');
      controls.className = 'playlist-detail__controls';

      const upBtn = document.createElement('button');
      upBtn.className = 'btn btn--small';
      upBtn.textContent = '↑';
      upBtn.setAttribute('aria-label', `Move ${song.title} up`);
      upBtn.disabled = index === 0;
      upBtn.addEventListener('click', () => {
        this._movePlaylistSong(playlist, index, index - 1);
      });

      const downBtn = document.createElement('button');
      downBtn.className = 'btn btn--small';
      downBtn.textContent = '↓';
      downBtn.setAttribute('aria-label', `Move ${song.title} down`);
      downBtn.disabled = index === playlist.songIds.length - 1;
      downBtn.addEventListener('click', () => {
        this._movePlaylistSong(playlist, index, index + 1);
      });

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn--small';
      removeBtn.textContent = '✕';
      removeBtn.setAttribute('aria-label', `Remove ${song.title}`);
      removeBtn.addEventListener('click', () => {
        playlist.songIds.splice(index, 1);
        playlist.updatedAt = Date.now();
        this._savePlaylists();
        this._renderPlaylistDetail(playlist);
      });

      controls.appendChild(upBtn);
      controls.appendChild(downBtn);
      controls.appendChild(removeBtn);

      row.appendChild(titleSpan);
      row.appendChild(controls);
      list.appendChild(row);
    });

    container.appendChild(list);

    if (playlist.songIds.length === 0) {
      const emptyMsg = document.createElement('p');
      emptyMsg.className = 'playlist-detail__empty';
      emptyMsg.textContent = 'This playlist is empty.';
      container.appendChild(emptyMsg);
    }
  }

  _movePlaylistSong(playlist, fromIndex, toIndex) {
    const [song] = playlist.songIds.splice(fromIndex, 1);
    playlist.songIds.splice(toIndex, 0, song);
    playlist.updatedAt = Date.now();
    this._savePlaylists();
    this._renderPlaylistDetail(playlist);
  }

  _updateSelectionButtons() {
    const playBtn = document.getElementById('btn-play-selected');
    const createBtn = document.getElementById('btn-create-playlist');
    const hasSelection = this.state.ui.selectedSongIds.size > 0;
    if (playBtn) playBtn.disabled = !hasSelection;
    if (createBtn) createBtn.disabled = !hasSelection;
  }

  _updatePlayerUI() {
    const statusEl = document.getElementById('player-status');
    const titleEl = document.getElementById('player-song-title');
    const playIcon = document.querySelector('.icon-play');
    const pauseIcon = document.querySelector('.icon-pause');
    const loadingEl = document.getElementById('player-loading');

    const song = this.audio.getCurrentSong();

    if (statusEl) {
      switch (this.state.playback.status) {
        case 'playing': statusEl.textContent = 'Now Playing'; break;
        case 'paused': statusEl.textContent = 'Paused'; break;
        case 'buffering': statusEl.textContent = 'Loading'; break;
        default: statusEl.textContent = ''; break;
      }
    }

    if (titleEl) {
      titleEl.textContent = song ? song.title : '';
    }

    // Play/pause icon
    if (playIcon && pauseIcon) {
      if (this.state.playback.status === 'playing') {
        playIcon.style.display = 'none';
        pauseIcon.style.display = 'block';
      } else {
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
      }
    }

    // Loading spinner
    if (loadingEl) {
      loadingEl.hidden = this.state.playback.status !== 'buffering';
    }

    // Update active song highlight in list
    document.querySelectorAll('.song-row').forEach(row => {
      row.classList.toggle('song-row--active', row.dataset.songId === this.state.playback.currentSongId);
    });
  }

  _updateProgressUI(elapsed, duration) {
    const elapsedEl = document.getElementById('player-elapsed');
    const durationEl = document.getElementById('player-duration');
    const fillEl = document.getElementById('progress-fill');
    const trackEl = document.getElementById('progress-track');

    if (elapsedEl) elapsedEl.textContent = formatTime(elapsed);
    if (durationEl) durationEl.textContent = formatTime(duration);

    const fraction = duration > 0 ? (elapsed / duration) * 100 : 0;
    if (fillEl) fillEl.style.width = `${fraction}%`;
    if (trackEl) trackEl.setAttribute('aria-valuenow', Math.round(fraction));
  }

  _updateShuffleUI() {
    const btn = document.getElementById('btn-shuffle');
    if (!btn) return;
    btn.classList.toggle('player-btn--active', this.state.playback.shuffle);
    btn.setAttribute('aria-pressed', this.state.playback.shuffle ? 'true' : 'false');
    btn.setAttribute('aria-label', `Shuffle: ${this.state.playback.shuffle ? 'On' : 'Off'}`);
  }

  _updateLoopUI() {
    const btn = document.getElementById('btn-loop');
    if (!btn) return;
    btn.classList.toggle('player-btn--active', this.state.playback.loop);
    btn.setAttribute('aria-pressed', this.state.playback.loop ? 'true' : 'false');
    btn.setAttribute('aria-label', `Loop: ${this.state.playback.loop ? 'On' : 'Off'}`);
  }

  _updateTimerUI() {
    const timerEl = document.getElementById('player-timer');
    if (!timerEl) return;

    if (this.state.playback.timedMode && this.state.playback.timedMode.remainingSeconds > 0) {
      timerEl.hidden = false;
      timerEl.textContent = `${formatTime(this.state.playback.timedMode.remainingSeconds)} remaining`;
    } else if (this.state.playback.timedMode && !this.state.playback.timedMode.active) {
      timerEl.hidden = false;
      timerEl.textContent = 'Your listening session has ended';
      setTimeout(() => { timerEl.hidden = true; }, 5000);
    } else {
      timerEl.hidden = true;
    }
  }

  // --- Dialog Helpers (polyfill for older browsers without <dialog> support) ---

  _openDialog(dialog) {
    if (dialog.showModal) {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  _closeDialog(dialog) {
    if (dialog.close) {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
  }

  _confirmDeletePlaylist(playlist) {
    const dialog = document.getElementById('dialog-confirm-delete');
    const msgEl = document.getElementById('dialog-delete-message');
    if (!dialog) return;

    if (msgEl) msgEl.textContent = `Delete "${playlist.name}"?`;
    dialog.dataset.playlistId = playlist.id;
    this._openDialog(dialog);
  }


  // ============================================================
  // EVENT BINDING
  // ============================================================

  _bindEvents() {
    // Audio engine events
    this.audio.on('songStarted', (song) => {
      this.state.playback.status = 'playing';
      this._updatePlayerUI();
      this._addToRecentlyPlayed(song);
    });

    this.audio.on('songEnded', (song) => {
      // Handle timed playback end
      if (this.state.playback.timedMode && !this.state.playback.timedMode.active) {
        this.state.playback.status = 'stopped';
        this.state.playback.currentSongId = null;
        this._stopTimedPlayback();
        this._updatePlayerUI();
        this._announce('Your listening session has ended');
        return;
      }

      // Auto-advance
      this._skipForward();
    });

    this.audio.on('songError', (song) => {
      this._announce(`Couldn't play ${song ? song.title : 'song'} — skipping to next song`);
      this._skipForward();
    });

    this.audio.on('playbackPaused', () => {
      this.state.playback.status = 'paused';
      this._updatePlayerUI();
    });

    this.audio.on('buffering', () => {
      this.state.playback.status = 'buffering';
      this._updatePlayerUI();
    });

    this.audio.on('bufferingEnd', () => {
      if (this.state.playback.status === 'buffering') {
        this.state.playback.status = 'playing';
        this._updatePlayerUI();
      }
    });

    this.audio.on('timeUpdate', ({ elapsed, duration }) => {
      this.state.playback.elapsed = elapsed;
      this.state.playback.duration = duration;
      this._updateProgressUI(elapsed, duration);
    });

    // Transport controls
    const playPauseBtn = document.getElementById('btn-play-pause');
    if (playPauseBtn) {
      playPauseBtn.addEventListener('click', () => {
        this.audio.init(); // Unlock AudioContext on user gesture
        if (this.state.playback.status === 'playing') {
          this.audio.pause();
        } else if (this.state.playback.status === 'paused') {
          this.audio.resume();
        } else if (this.state.queue.songs.length > 0) {
          this._playCurrent();
        }
      });
    }

    const prevBtn = document.getElementById('btn-prev');
    if (prevBtn) prevBtn.addEventListener('click', () => this._skipBack());

    const nextBtn = document.getElementById('btn-next');
    if (nextBtn) nextBtn.addEventListener('click', () => this._skipForward());

    const shuffleBtn = document.getElementById('btn-shuffle');
    if (shuffleBtn) shuffleBtn.addEventListener('click', () => this._toggleShuffle());

    const loopBtn = document.getElementById('btn-loop');
    if (loopBtn) loopBtn.addEventListener('click', () => this._toggleLoop());

    // Volume
    const volumeSlider = document.getElementById('volume-slider');
    if (volumeSlider) {
      volumeSlider.value = String(this.state.playback.volume * 100);
      volumeSlider.addEventListener('input', (e) => {
        this.state.playback.volume = parseInt(e.target.value) / 100;
        this.audio.setVolume(this.state.playback.volume);
        this._saveDebounced();
      });
    }

    const muteBtn = document.getElementById('btn-mute');
    if (muteBtn) {
      muteBtn.addEventListener('click', () => {
        const volIcon = muteBtn.querySelector('.icon-volume');
        const mutedIcon = muteBtn.querySelector('.icon-muted');
        if (this.audio._audio.muted) {
          this.audio._audio.muted = false;
          if (volIcon) volIcon.style.display = 'block';
          if (mutedIcon) mutedIcon.style.display = 'none';
        } else {
          this.audio._audio.muted = true;
          if (volIcon) volIcon.style.display = 'none';
          if (mutedIcon) mutedIcon.style.display = 'block';
        }
      });
    }

    // Progress bar scrub
    const progressTrack = document.getElementById('progress-track');
    if (progressTrack) {
      let isScrubbing = false;

      const handleScrub = (e) => {
        const rect = progressTrack.getBoundingClientRect();
        const clientX = (e.clientX != null) ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
        const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        this.audio.seekFraction(fraction);
      };

      progressTrack.addEventListener('pointerdown', (e) => {
        isScrubbing = true;
        handleScrub(e);
        progressTrack.setPointerCapture(e.pointerId);
      });

      progressTrack.addEventListener('pointermove', (e) => {
        if (isScrubbing) handleScrub(e);
      });

      progressTrack.addEventListener('pointerup', () => {
        isScrubbing = false;
      });

      // Keyboard support for progress bar
      progressTrack.addEventListener('keydown', (e) => {
        const duration = this.audio.getDuration();
        if (!duration) return;
        const step = duration * 0.05; // 5% steps
        if (e.key === 'ArrowRight') {
          this.audio.seek(this.audio.getElapsed() + step);
        } else if (e.key === 'ArrowLeft') {
          this.audio.seek(this.audio.getElapsed() - step);
        }
      });
    }

    // Search
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      const debouncedSearch = debounce(() => {
        this.state.ui.searchQuery = searchInput.value;
        this._applyFilters();
        this._renderSongList();
      }, 150);
      searchInput.addEventListener('input', debouncedSearch);
    }

    // Sort
    const sortSelect = document.getElementById('sort-select');
    if (sortSelect) {
      sortSelect.value = this.state.ui.sortOrder;
      sortSelect.addEventListener('change', () => {
        this.state.ui.sortOrder = sortSelect.value;
        this._applyFilters();
        this._renderSongList();
        this._saveDebounced();
      });
    }

    // Play All button
    const playAllBtn = document.getElementById('btn-play-all');
    if (playAllBtn) {
      playAllBtn.addEventListener('click', () => {
        this.audio.init(); // Unlock AudioContext on user gesture
        this._playAll();
      });
    }

    // Play Selected button
    const playSelectedBtn = document.getElementById('btn-play-selected');
    if (playSelectedBtn) {
      playSelectedBtn.addEventListener('click', () => {
        this.audio.init();
        this._playSelected();
      });
    }

    // Create Playlist
    const createPlaylistBtn = document.getElementById('btn-create-playlist');
    if (createPlaylistBtn) {
      createPlaylistBtn.addEventListener('click', () => {
        if (this.state.ui.selectedSongIds.size === 0) {
          this._announce('Select some songs first, then create a playlist.');
          return;
        }
        const dialog = document.getElementById('dialog-playlist-name');
        if (dialog) this._openDialog(dialog);
      });
    }

    // Playlist Name Dialog
    const playlistSaveBtn = document.getElementById('dialog-playlist-save');
    const playlistCancelBtn = document.getElementById('dialog-playlist-cancel');
    const playlistNameInput = document.getElementById('playlist-name-input');
    const playlistDialog = document.getElementById('dialog-playlist-name');

    if (playlistSaveBtn && playlistDialog) {
      playlistSaveBtn.addEventListener('click', () => {
        const name = playlistNameInput ? playlistNameInput.value.trim() : '';
        this._createPlaylist(name || 'My Playlist');
        if (playlistNameInput) playlistNameInput.value = '';
        this._closeDialog(playlistDialog);
      });
    }
    if (playlistCancelBtn && playlistDialog) {
      playlistCancelBtn.addEventListener('click', () => {
        this._closeDialog(playlistDialog);
      });
    }

    // Delete Confirmation Dialog
    const deleteConfirmBtn = document.getElementById('dialog-delete-confirm');
    const deleteCancelBtn = document.getElementById('dialog-delete-cancel');
    const deleteDialog = document.getElementById('dialog-confirm-delete');

    if (deleteConfirmBtn && deleteDialog) {
      deleteConfirmBtn.addEventListener('click', () => {
        const playlistId = deleteDialog.dataset.playlistId;
        if (playlistId) this._deletePlaylist(playlistId);
        this._closeDialog(deleteDialog);
      });
    }
    if (deleteCancelBtn && deleteDialog) {
      deleteCancelBtn.addEventListener('click', () => {
        this._closeDialog(deleteDialog);
      });
    }

    // Timed Playback
    const timedBtn = document.getElementById('btn-timed-top');
    const timedDialog = document.getElementById('dialog-timed');
    const timedCancelBtn = document.getElementById('dialog-timed-cancel');

    if (timedBtn && timedDialog) {
      timedBtn.addEventListener('click', () => {
        if (this.state.playback.timedMode && this.state.playback.timedMode.active) {
          // Cancel timed playback
          this._stopTimedPlayback();
          this._announce('Timed playback cancelled');
        } else {
          this._openDialog(timedDialog);
        }
      });
    }

    if (timedDialog) {
      timedDialog.querySelectorAll('[data-minutes]').forEach(btn => {
        btn.addEventListener('click', () => {
          const minutes = parseInt(btn.dataset.minutes);
          this._closeDialog(timedDialog);
          this._startTimedPlayback(minutes);
          this._announce(`Timed playback started: ${minutes} minutes`);
        });
      });
    }

    if (timedCancelBtn && timedDialog) {
      timedCancelBtn.addEventListener('click', () => this._closeDialog(timedDialog));
    }

    // Footer reset link
    const resetLink = document.getElementById('footer-reset');
    if (resetLink) {
      resetLink.addEventListener('click', (e) => {
        e.preventDefault();
        if (confirm('This will clear all your saved playlists and preferences. Continue?')) {
          StorageManager.resetAll();
          window.location.reload();
        }
      });
    }

    // Keyboard navigation for song list
    const songListContainer = document.getElementById('song-list-container');
    if (songListContainer) {
      songListContainer.addEventListener('keydown', (e) => {
        const rows = songListContainer.querySelectorAll('.song-row');
        if (rows.length === 0) return;

        const focused = songListContainer.querySelector('.song-row--focused');
        let currentIdx = focused ? [...rows].indexOf(focused) : -1;

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (currentIdx < rows.length - 1) {
            if (focused) focused.classList.remove('song-row--focused');
            rows[currentIdx + 1].classList.add('song-row--focused');
            rows[currentIdx + 1].scrollIntoView({ block: 'nearest' });
          }
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (currentIdx > 0) {
            if (focused) focused.classList.remove('song-row--focused');
            rows[currentIdx - 1].classList.add('song-row--focused');
            rows[currentIdx - 1].scrollIntoView({ block: 'nearest' });
          }
        } else if (e.key === 'Enter' && focused) {
          e.preventDefault();
          const songId = focused.dataset.songId;
          const song = this.state.filteredSongs.find(s => s.id === songId);
          if (song) this._playFromSongList(song);
        }
      });
    }

    // Initialize UI state
    this._updateShuffleUI();
    this._updateLoopUI();
    this._updateSelectionButtons();
  }
}

// ============================================================
// BOOT
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  const app = new HymnsApp();
  app.init();
});
