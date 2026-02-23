#!/usr/bin/env node
/**
 * Generates tracks.json — a manifest of all GPX files in tracks/.
 * Used by both the dev server and GitHub Pages to list available tracks.
 *
 * Usage: node scripts/generate-manifest.js
 * Output: tracks.json
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const tracksDir = path.join(repoRoot, 'tracks');

if (!fs.existsSync(tracksDir)) {
  console.error('No tracks/ directory found.');
  process.exit(1);
}

const files = fs.readdirSync(tracksDir)
  .filter(f => f.endsWith('.gpx'))
  .sort();

if (files.length === 0) {
  console.error('No .gpx files found in tracks/.');
  process.exit(1);
}

const outPath = path.join(repoRoot, 'tracks.json');
fs.writeFileSync(outPath, JSON.stringify(files, null, 2) + '\n', 'utf-8');
console.log(`Written: tracks.json (${files.length} track(s))`);
