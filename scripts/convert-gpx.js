#!/usr/bin/env node
/**
 * Embeds all GPX files from tracks/ into the userscript.
 *
 * Usage:
 *   node scripts/convert-gpx.js           — embeds all .gpx files from tracks/
 *   node scripts/convert-gpx.js file.gpx  — embeds a single file
 *
 * Outputs: dist/topptur-gpx-overlay.user.js
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const tracksDir = path.join(repoRoot, 'tracks');
const trkptBlockRegex = /<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/g;
const eleRegex = /<ele>([^<]+)<\/ele>/;
const timeInBlockRegex = /<time>([^<]+)<\/time>/;
const nameRegex = /<trk>\s*<name>([^<]+)<\/name>/;
const dateRegex = /<metadata>\s*(?:<[^>]+>[^<]*<\/[^>]+>\s*)*<time>([^<]+)<\/time>/;
const trkptTimeRegex = /<trkpt[^>]*>[\s\S]*?<time>([^<]+)<\/time>/;

function parseGpx(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8');
  const coords = [];
  const points = []; // compact: [lat, lon, ele, epochMs]
  let match;
  trkptBlockRegex.lastIndex = 0;
  while ((match = trkptBlockRegex.exec(text)) !== null) {
    const lat = parseFloat(match[1]);
    const lon = parseFloat(match[2]);
    if (isNaN(lat) || isNaN(lon)) continue;
    const body = match[3];
    const roundLat = Math.round(lat * 1e6) / 1e6;
    const roundLon = Math.round(lon * 1e6) / 1e6;
    coords.push([roundLat, roundLon]);
    const eleMatch = body.match(eleRegex);
    const timeMatch = body.match(timeInBlockRegex);
    points.push([
      roundLat, roundLon,
      eleMatch ? Math.round(parseFloat(eleMatch[1]) * 10) / 10 : null,
      timeMatch ? new Date(timeMatch[1]).getTime() : null,
    ]);
  }
  const nameMatch = text.match(nameRegex);
  const name = nameMatch ? nameMatch[1] : path.basename(filePath, '.gpx');
  // Extract date from metadata or first trackpoint
  const dateMatch = text.match(dateRegex) || text.match(trkptTimeRegex);
  const date = dateMatch ? dateMatch[1] : null;
  return { name, coords, date, points };
}

// Collect GPX files
let gpxFiles;
if (process.argv[2]) {
  gpxFiles = [path.resolve(process.argv[2])];
} else {
  if (!fs.existsSync(tracksDir)) {
    console.error('No tracks/ directory found. Create it and add .gpx files.');
    process.exit(1);
  }
  gpxFiles = fs.readdirSync(tracksDir)
    .filter(f => f.endsWith('.gpx'))
    .map(f => path.join(tracksDir, f));
}

if (gpxFiles.length === 0) {
  console.error('No .gpx files found.');
  process.exit(1);
}

// Parse all
const embedded = gpxFiles.map(f => {
  const { name, coords, date, points } = parseGpx(f);
  console.log(`  ${path.basename(f)}: "${name}" ${date ? date.slice(0,10) : '(no date)'} — ${coords.length} points, ${points.length} with ele/time`);
  return { name, coords, date, points };
}).filter(t => t.coords.length > 0);

console.log(`\nEmbedding ${embedded.length} track(s)`);

// Read template and replace placeholder
const template = fs.readFileSync(path.join(repoRoot, 'gpx-overlay.user.js'), 'utf-8');
const json = JSON.stringify(embedded);
const output = template.replace(
  /const EMBEDDED_TRACKS = null; \/\/ __TRACKS_PLACEHOLDER__/,
  `const EMBEDDED_TRACKS = ${json};`
);

// Write userscript
const distDir = path.join(repoRoot, 'dist');
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
const outPath = path.join(distDir, 'topptur-gpx-overlay.user.js');
fs.writeFileSync(outPath, output, 'utf-8');
console.log(`Written: dist/topptur-gpx-overlay.user.js (${(Buffer.byteLength(output) / 1024).toFixed(1)} KB)`);

// Also generate tracks.json manifest
const manifest = gpxFiles.map(f => path.basename(f));
const manifestPath = path.join(repoRoot, 'tracks.json');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
console.log(`Written: tracks.json (${manifest.length} track(s))`);
