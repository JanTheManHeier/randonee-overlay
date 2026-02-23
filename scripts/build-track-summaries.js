#!/usr/bin/env node
/**
 * Pre-computes track summaries from GPX files for the recommendation page.
 *
 * Reads all .gpx files from tracks/ and generates track-summaries.json
 * with start coordinates, max elevation, ascent, distance, date, and name.
 *
 * Usage: node scripts/build-track-summaries.js
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const tracksDir = path.join(repoRoot, 'tracks');

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const trkptRegex = /<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/g;
const eleRegex = /<ele>([^<]+)<\/ele>/;
const timeInBlockRegex = /<time>([^<]+)<\/time>/;
const nameRegex = /<trk>\s*<name>([^<]+)<\/name>/;
const dateRegex = /<metadata>\s*(?:<[^>]+>[^<]*<\/[^>]+>\s*)*<time>([^<]+)<\/time>/;
const trkptTimeRegex = /<trkpt[^>]*>[\s\S]*?<time>([^<]+)<\/time>/;

function parseGpxSummary(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8');
  const points = [];
  let match;
  trkptRegex.lastIndex = 0;
  while ((match = trkptRegex.exec(text)) !== null) {
    const lat = parseFloat(match[1]);
    const lon = parseFloat(match[2]);
    if (isNaN(lat) || isNaN(lon)) continue;
    const body = match[3];
    const eleMatch = body.match(eleRegex);
    points.push({
      lat, lon,
      ele: eleMatch ? parseFloat(eleMatch[1]) : null,
    });
  }

  if (points.length === 0) return null;

  // Smooth elevation with a moving average to reduce GPS noise
  const SMOOTH_WINDOW = 10;
  const smoothEle = points.map((p, i) => {
    if (p.ele === null) return null;
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - SMOOTH_WINDOW); j <= Math.min(points.length - 1, i + SMOOTH_WINDOW); j++) {
      if (points[j].ele !== null) { sum += points[j].ele; count++; }
    }
    return count > 0 ? sum / count : null;
  });

  // Compute stats using smoothed elevation
  let maxEle = -Infinity;
  let distance = 0;
  let ascent = 0;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.ele !== null && p.ele > maxEle) maxEle = p.ele;
    if (i === 0) continue;
    const prev = points[i - 1];
    const segDist = haversineKm(prev.lat, prev.lon, p.lat, p.lon);
    if (segDist > 2) continue; // skip GPS glitches
    distance += segDist;
    if (smoothEle[i - 1] !== null && smoothEle[i] !== null) {
      const delta = smoothEle[i] - smoothEle[i - 1];
      if (delta > 0 && delta < 200) ascent += delta;
    }
  }

  const nameMatch = text.match(nameRegex);
  const name = nameMatch ? nameMatch[1] : path.basename(filePath, '.gpx');

  const dateMatch = text.match(dateRegex) || text.match(trkptTimeRegex);
  const date = dateMatch ? dateMatch[1] : null;

  return {
    filename: path.basename(filePath),
    name,
    date,
    startLat: points[0].lat,
    startLon: points[0].lon,
    maxEle: maxEle === -Infinity ? null : Math.round(maxEle),
    ascent: Math.round(ascent),
    distance: Math.round(distance * 10) / 10,
  };
}

// Process all GPX files
const gpxFiles = fs.readdirSync(tracksDir)
  .filter(f => f.endsWith('.gpx'))
  .map(f => path.join(tracksDir, f));

console.log(`Processing ${gpxFiles.length} GPX files...`);

const summaries = [];
gpxFiles.forEach(f => {
  const summary = parseGpxSummary(f);
  if (summary) {
    summaries.push(summary);
    if (summary.ascent < 50) {
      console.log(`  Warning: ${summary.name} has only ${summary.ascent}m ascent`);
    }
  } else {
    console.warn(`  Skipped ${path.basename(f)}: no trackpoints`);
  }
});

const outPath = path.join(repoRoot, 'track-summaries.json');
fs.writeFileSync(outPath, JSON.stringify(summaries, null, 2) + '\n', 'utf-8');
console.log(`\nWritten: track-summaries.json (${summaries.length} tracks, ${(Buffer.byteLength(JSON.stringify(summaries)) / 1024).toFixed(1)} KB)`);

// Stats
const withAscent = summaries.filter(s => s.ascent > 50);
const avgAscent = withAscent.length > 0 ? Math.round(withAscent.reduce((s, t) => s + t.ascent, 0) / withAscent.length) : 0;
console.log(`Tracks with >50m ascent: ${withAscent.length}, avg ascent: ${avgAscent}m`);
