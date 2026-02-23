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
const trkptRegex = /<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"/g;
const nameRegex = /<trk>\s*<name>([^<]+)<\/name>/;
const dateRegex = /<metadata>\s*(?:<[^>]+>[^<]*<\/[^>]+>\s*)*<time>([^<]+)<\/time>/;
const trkptTimeRegex = /<trkpt[^>]*>[\s\S]*?<time>([^<]+)<\/time>/;

function parseGpx(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8');
  const coords = [];
  let match;
  trkptRegex.lastIndex = 0;
  while ((match = trkptRegex.exec(text)) !== null) {
    const lat = parseFloat(match[1]);
    const lon = parseFloat(match[2]);
    if (!isNaN(lat) && !isNaN(lon)) {
      coords.push([Math.round(lat * 1e6) / 1e6, Math.round(lon * 1e6) / 1e6]);
    }
  }
  const nameMatch = text.match(nameRegex);
  const name = nameMatch ? nameMatch[1] : path.basename(filePath, '.gpx');
  // Extract date from metadata or first trackpoint
  const dateMatch = text.match(dateRegex) || text.match(trkptTimeRegex);
  const date = dateMatch ? dateMatch[1] : null;
  return { name, coords, date };
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
  const { name, coords, date } = parseGpx(f);
  console.log(`  ${path.basename(f)}: "${name}" ${date ? date.slice(0,10) : '(no date)'} — ${coords.length} points`);
  return { name, coords, date };
}).filter(t => t.coords.length > 0);

console.log(`\nEmbedding ${embedded.length} track(s)`);

// Read template and replace placeholder
const template = fs.readFileSync(path.join(repoRoot, 'gpx-overlay.user.js'), 'utf-8');
const json = JSON.stringify(embedded);
const output = template.replace(
  /const EMBEDDED_TRACKS = null; \/\/ __TRACKS_PLACEHOLDER__/,
  `const EMBEDDED_TRACKS = ${json};`
);

// Write
const distDir = path.join(repoRoot, 'dist');
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
const outPath = path.join(distDir, 'topptur-gpx-overlay.user.js');
fs.writeFileSync(outPath, output, 'utf-8');
console.log(`Written: dist/topptur-gpx-overlay.user.js (${(Buffer.byteLength(output) / 1024).toFixed(1)} KB)`);
