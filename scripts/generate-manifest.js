#!/usr/bin/env node

/**
 * Manifest Generation Script
 * Scans the songs/ directory and produces songs/manifest.json.
 *
 * Usage: node scripts/generate-manifest.js
 *
 * For each .mp3 file found recursively:
 *   - id: relative path minus "songs/" prefix and ".mp3" extension
 *   - title: filename with dashes/underscores replaced by spaces, extension removed
 *   - genre: parent directory name with dashes/underscores replaced by spaces
 *   - path: relative path from project root
 *   - duration: read from MP3 file (estimated from file size + bitrate)
 */

const fs = require('fs');
const path = require('path');

const SONGS_DIR = path.join(__dirname, '..', 'songs');
const OUTPUT_FILE = path.join(SONGS_DIR, 'manifest.json');
const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB warning threshold

function deriveTitle(filename) {
  // Remove extension, replace dashes and underscores with spaces, title case
  const name = path.basename(filename, '.mp3');
  return name.replace(/[-_]/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function deriveGenre(dirName) {
  return dirName.replace(/[-_]/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function deriveId(relativePath) {
  // Strip "songs/" prefix and ".mp3" extension
  return relativePath
    .replace(/^songs\//, '')
    .replace(/\.mp3$/i, '');
}

/**
 * Estimate MP3 duration from file size.
 * Assumes 128kbps average bitrate (common for piano recordings).
 * This is a rough estimate — for accurate durations, use an ID3/MP3 parser.
 */
function estimateDuration(filePath) {
  try {
    const stats = fs.statSync(filePath);
    const fileSizeBytes = stats.size;
    // Assume 128kbps = 16000 bytes/second
    const durationSeconds = Math.round(fileSizeBytes / 16000);
    return durationSeconds;
  } catch (e) {
    return 0;
  }
}

function scanDirectory(dir, basePath) {
  const entries = [];
  const seen = new Set();

  function walk(currentDir) {
    const items = fs.readdirSync(currentDir);

    for (const item of items) {
      const fullPath = path.join(currentDir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (item.toLowerCase().endsWith('.mp3')) {
        const relativePath = path.relative(basePath, fullPath).replace(/\\/g, '/');
        const songsRelative = 'songs/' + relativePath;
        const id = deriveId(songsRelative);

        // Check for duplicate IDs
        if (seen.has(id)) {
          console.warn(`⚠️  Duplicate ID "${id}" — skipping ${fullPath}`);
          continue;
        }
        seen.add(id);

        // Check file size
        if (stat.size > MAX_FILE_SIZE) {
          console.warn(`⚠️  Large file (${(stat.size / 1024 / 1024).toFixed(1)}MB): ${item}`);
        }

        // Derive metadata
        const parentDir = path.basename(path.dirname(fullPath));
        const title = deriveTitle(item);
        const genre = parentDir === 'songs' ? 'Uncategorized' : deriveGenre(parentDir);
        const duration = estimateDuration(fullPath);

        entries.push({
          id,
          title,
          genre,
          path: songsRelative,
          duration,
        });
      }
    }
  }

  walk(dir);
  return entries;
}

// Main
function main() {
  console.log('🎵 Generating song manifest...');
  console.log(`   Scanning: ${SONGS_DIR}`);

  if (!fs.existsSync(SONGS_DIR)) {
    console.log('   Creating songs/ directory...');
    fs.mkdirSync(SONGS_DIR, { recursive: true });
  }

  const songs = scanDirectory(SONGS_DIR, SONGS_DIR);

  // Sort alphabetically by title
  songs.sort((a, b) => a.title.localeCompare(b.title));

  const manifest = { songs };
  const json = JSON.stringify(manifest, null, 2);

  fs.writeFileSync(OUTPUT_FILE, json, 'utf-8');

  console.log(`   ✅ Generated manifest with ${songs.length} songs`);
  console.log(`   Output: ${OUTPUT_FILE}`);

  // Summary by genre
  const genres = {};
  songs.forEach(s => {
    genres[s.genre] = (genres[s.genre] || 0) + 1;
  });
  if (Object.keys(genres).length > 0) {
    console.log('   Genres:');
    Object.entries(genres).sort().forEach(([genre, count]) => {
      console.log(`     - ${genre}: ${count} songs`);
    });
  }
}

main();
