#!/usr/bin/env node
/**
 * Analyzes ski touring tracks and topptur.guide tours for descent quality.
 *
 * Finds the best ski runs by looking for long, steep descents (~30 degrees).
 * Analyzes both local GPX tracks and topptur.guide tour coordinates.
 *
 * Usage: node scripts/analyze-descents.js [--gpx-only] [--tours-only] [--top N]
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const repoRoot = path.resolve(__dirname, '..');
const tracksDir = path.join(repoRoot, 'tracks');

// ── Configuration ──────────────────────────────────────────────
const SMOOTH_WINDOW = 10;
const MIN_DROP_M = 200;         // minimum descent to consider
const MIN_CLIMB_TO_RESET = 100; // climb this much = new descent segment
const STEEP_MIN_DEG = 25;
const STEEP_MAX_DEG = 35;
const CHUNK_DIST_M = 50;        // resolution for steep segment analysis
const TROMSO_BBOX = { minLat: 69.3, maxLat: 70.0, minLon: 18.0, maxLon: 20.5 };
const MAX_DRIVE_KM = 65;
const TROMSO = { lat: 69.6492, lon: 18.9553 };

// ── Helpers ────────────────────────────────────────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'randonee-overlay/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function smoothElevation(points, window) {
  return points.map((p, i) => {
    if (p.ele === null) return null;
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - window); j <= Math.min(points.length - 1, i + window); j++) {
      if (points[j].ele !== null) { sum += points[j].ele; count++; }
    }
    return count > 0 ? sum / count : null;
  });
}

// ── GPX Parsing ────────────────────────────────────────────────
const trkptRegex = /<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/g;
const eleRegex = /<ele>([^<]+)<\/ele>/;
const nameRegex = /<trk>\s*<name>([^<]+)<\/name>/;
const dateRegex = /<metadata>\s*(?:<[^>]+>[^<]*<\/[^>]+>\s*)*<time>([^<]+)<\/time>/;
const trkptTimeRegex = /<trkpt[^>]*>[\s\S]*?<time>([^<]+)<\/time>/;

function parseGpxPoints(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8');
  const points = [];
  let match;
  trkptRegex.lastIndex = 0;
  while ((match = trkptRegex.exec(text)) !== null) {
    const lat = parseFloat(match[1]);
    const lon = parseFloat(match[2]);
    if (isNaN(lat) || isNaN(lon)) continue;
    const eleMatch = match[3].match(eleRegex);
    points.push({ lat, lon, ele: eleMatch ? parseFloat(eleMatch[1]) : null });
  }

  const nameMatch = text.match(nameRegex);
  const name = nameMatch ? nameMatch[1] : path.basename(filePath, '.gpx');
  const dateMatch = text.match(dateRegex) || text.match(trkptTimeRegex);
  const date = dateMatch ? dateMatch[1] : null;

  return { points, name, date };
}

// ── Descent Segment Finding ────────────────────────────────────
function findDescentSegments(smoothEle) {
  const segments = [];
  let peakI = 0, peakEle = smoothEle[0] || 0;
  let troughI = 0, troughEle = smoothEle[0] || 0;

  for (let i = 1; i < smoothEle.length; i++) {
    const ele = smoothEle[i];
    if (ele === null) continue;

    if (ele > peakEle) {
      peakEle = ele;
      peakI = i;
      troughEle = ele;
      troughI = i;
    } else if (ele < troughEle) {
      troughEle = ele;
      troughI = i;
    } else if (ele > troughEle + MIN_CLIMB_TO_RESET) {
      // Started climbing — finalize descent if significant
      if (peakEle - troughEle >= MIN_DROP_M) {
        segments.push({ peakI, troughI, drop: peakEle - troughEle });
      }
      peakI = i;
      peakEle = ele;
      troughI = i;
      troughEle = ele;
    }
  }
  // Handle final descent
  if (peakEle - troughEle >= MIN_DROP_M) {
    segments.push({ peakI, troughI, drop: peakEle - troughEle });
  }

  return segments;
}

// ── Descent Analysis ───────────────────────────────────────────
function analyzeDescentSegment(points, smoothEle, peakI, troughI) {
  let horizDistM = 0;
  for (let i = peakI + 1; i <= troughI; i++) {
    const segDist = haversineKm(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon) * 1000;
    if (segDist > 2000) continue; // skip GPS glitches
    horizDistM += segDist;
  }

  if (horizDistM < 10) return null; // too short

  const verticalDrop = smoothEle[peakI] - smoothEle[troughI];
  const avgGradientDeg = Math.atan(verticalDrop / horizDistM) * (180 / Math.PI);

  const steepSegment = findLongestSteepSegment(points, smoothEle, peakI, troughI);

  return {
    verticalDrop: Math.round(verticalDrop),
    horizDistM: Math.round(horizDistM),
    avgGradientDeg: Math.round(avgGradientDeg * 10) / 10,
    peakEle: Math.round(smoothEle[peakI]),
    troughEle: Math.round(smoothEle[troughI]),
    steepSegment,
  };
}

function findLongestSteepSegment(points, smoothEle, peakI, troughI) {
  // Build chunks of ~CHUNK_DIST_M horizontal distance
  const chunks = [];
  let chunkStartI = peakI;
  let chunkDist = 0;

  for (let i = peakI + 1; i <= troughI; i++) {
    const segDist = haversineKm(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon) * 1000;
    if (segDist > 2000) continue;
    chunkDist += segDist;

    if (chunkDist >= CHUNK_DIST_M) {
      const startEle = smoothEle[chunkStartI];
      const endEle = smoothEle[i];
      if (startEle !== null && endEle !== null && chunkDist > 0) {
        const drop = startEle - endEle;
        const grad = Math.atan(Math.max(0, drop) / chunkDist) * (180 / Math.PI);
        chunks.push({ startI: chunkStartI, endI: i, dist: chunkDist, drop, grad });
      }
      chunkStartI = i;
      chunkDist = 0;
    }
  }

  // Find longest run of consecutive steep chunks
  let bestStart = 0, bestLen = 0;
  let curStart = 0, curLen = 0;

  for (let c = 0; c < chunks.length; c++) {
    if (chunks[c].grad >= STEEP_MIN_DEG && chunks[c].grad <= STEEP_MAX_DEG) {
      if (curLen === 0) curStart = c;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curLen = 0;
    }
  }

  if (bestLen === 0) return null;

  const steepChunks = chunks.slice(bestStart, bestStart + bestLen);
  const totalDist = steepChunks.reduce((s, c) => s + c.dist, 0);
  const totalDrop = steepChunks.reduce((s, c) => s + c.drop, 0);
  const avgGrad = Math.atan(totalDrop / totalDist) * (180 / Math.PI);

  return {
    verticalDrop: Math.round(totalDrop),
    horizDistM: Math.round(totalDist),
    avgGradientDeg: Math.round(avgGrad * 10) / 10,
    startEle: Math.round(smoothEle[steepChunks[0].startI]),
    endEle: Math.round(smoothEle[steepChunks[steepChunks.length - 1].endI]),
  };
}

// ── Scoring ────────────────────────────────────────────────────
function descentScore(analysis) {
  if (!analysis) return 0;
  let score = 0;

  // Primary: vertical drop (more = better)
  score += Math.min(analysis.verticalDrop, 1200) / 12; // 0-100

  // Gradient proximity to 30 degrees
  const gradDiff = Math.abs(analysis.avgGradientDeg - 30);
  score += Math.max(0, 50 - gradDiff * 5); // 0-50

  // Bonus for long continuous steep section
  if (analysis.steepSegment) {
    score += Math.min(analysis.steepSegment.verticalDrop, 500) / 10; // 0-50
  }

  return Math.round(score * 10) / 10;
}

// ── Analyze GPX tracks ────────────────────────────────────────
function analyzeGpxTracks() {
  const gpxFiles = fs.readdirSync(tracksDir)
    .filter(f => f.endsWith('.gpx'))
    .map(f => path.join(tracksDir, f));

  console.log(`Analyzing ${gpxFiles.length} GPX tracks...`);
  const results = [];

  gpxFiles.forEach(f => {
    const { points, name, date } = parseGpxPoints(f);
    if (points.length < 50) return;

    const smoothEle = smoothElevation(points, SMOOTH_WINDOW);
    const segments = findDescentSegments(smoothEle);
    if (segments.length === 0) return;

    // Find the best descent segment
    let bestAnalysis = null;
    let bestScore = 0;
    segments.forEach(seg => {
      const analysis = analyzeDescentSegment(points, smoothEle, seg.peakI, seg.troughI);
      if (!analysis) return;
      const score = descentScore(analysis);
      if (score > bestScore) {
        bestScore = score;
        bestAnalysis = analysis;
      }
    });

    if (bestAnalysis) {
      results.push({
        source: 'gpx',
        name,
        filename: path.basename(f),
        date,
        descent: bestAnalysis,
        score: bestScore,
      });
    }
  });

  return results;
}

// ── Analyze topptur.guide tours ───────────────────────────────
async function analyzeToppturTours() {
  console.log('Fetching topptur.guide tour data...');

  const pageHtml = await httpsGet('https://topptur.guide/');
  const indexMatch = pageHtml.match(/src="\/assets\/index\.([A-Za-z0-9_-]+)\.js"/);
  if (!indexMatch) throw new Error('Could not find index.js reference');

  const indexJs = await httpsGet(`https://topptur.guide/assets/index.${indexMatch[1]}.js`);
  const toursMatch = indexJs.match(/tours\.([A-Za-z0-9_-]+)\.js/);
  if (!toursMatch) throw new Error('Could not find tours.js reference');

  const toursJs = await httpsGet(`https://topptur.guide/assets/tours.${toursMatch[1]}.js`);
  const cleanJs = toursJs.replace(/;?\s*export\s*\{[^}]*\}\s*;?\s*$/, '');
  const allTours = new Function(cleanJs + '; return e;')();
  console.log(`Parsed ${allTours.length} tours, filtering to Tromsø area...`);

  const results = [];

  allTours.forEach(t => {
    if (!t.coordinates || t.coordinates.length < 5) return;
    const [lon, lat] = t.coordinates[0];
    if (lat < TROMSO_BBOX.minLat || lat > TROMSO_BBOX.maxLat ||
        lon < TROMSO_BBOX.minLon || lon > TROMSO_BBOX.maxLon) return;

    // Convert coordinates to points format [lon, lat, ele] -> { lat, lon, ele }
    const points = t.coordinates.map(c => ({ lat: c[1], lon: c[0], ele: c[2] || 0 }));

    const distFromTromso = haversineKm(TROMSO.lat, TROMSO.lon, points[0].lat, points[0].lon);
    if (distFromTromso > MAX_DRIVE_KM) return;

    // Tours are sparse (25-50 points), no smoothing needed
    const eleArr = points.map(p => p.ele);

    // For tours that go up (trailhead to summit), we analyze the descent
    // by looking at the elevation profile as-is (algorithm finds peaks and descents)
    const segments = findDescentSegments(eleArr);

    // If no descent found, the tour might be an ascent route —
    // reverse it to analyze the descent (skiing down)
    let bestAnalysis = null;
    let bestScore = 0;

    if (segments.length === 0) {
      // Reverse: analyze as if skiing down
      const revPoints = [...points].reverse();
      const revEle = revPoints.map(p => p.ele);
      const revSegments = findDescentSegments(revEle);
      revSegments.forEach(seg => {
        const analysis = analyzeDescentSegment(revPoints, revEle, seg.peakI, seg.troughI);
        if (!analysis) return;
        const score = descentScore(analysis);
        if (score > bestScore) { bestScore = score; bestAnalysis = analysis; }
      });
    } else {
      segments.forEach(seg => {
        const analysis = analyzeDescentSegment(points, eleArr, seg.peakI, seg.troughI);
        if (!analysis) return;
        const score = descentScore(analysis);
        if (score > bestScore) { bestScore = score; bestAnalysis = analysis; }
      });
    }

    if (bestAnalysis) {
      results.push({
        source: 'topptur',
        name: t.name,
        id: t.id,
        place: t.place,
        ates: t.ates,
        distFromTromso: Math.round(distFromTromso * 10) / 10,
        descent: bestAnalysis,
        score: bestScore,
      });
    }
  });

  console.log(`Analyzed ${results.length} tours with significant descents`);
  return results;
}

// ── Output ─────────────────────────────────────────────────────
function printTable(results, topN) {
  console.log('');
  console.log('='.repeat(110));
  console.log('  BEST SKI RUNS — ranked by descent quality (targeting ~30° gradient)');
  console.log('='.repeat(110));
  console.log('');

  const header = [
    'Rank'.padStart(4),
    'Name'.padEnd(38),
    'Source'.padEnd(8),
    'Drop'.padStart(6),
    'Run'.padStart(8),
    'Grad'.padStart(6),
    'Steep Section'.padEnd(18),
    'From-To'.padEnd(16),
    'Score'.padStart(6),
  ].join('  ');
  console.log(header);
  console.log('-'.repeat(120));

  results.slice(0, topN).forEach((r, i) => {
    const d = r.descent;
    const ss = d.steepSegment;
    const steepStr = ss
      ? `${ss.verticalDrop}m @ ${ss.avgGradientDeg}°`
      : '—';
    const rangeStr = ss
      ? `${ss.startEle}m → ${ss.endEle}m`
      : '';

    const row = [
      `${i + 1}.`.padStart(4),
      r.name.slice(0, 38).padEnd(38),
      r.source.padEnd(8),
      `${d.verticalDrop}m`.padStart(6),
      `${(d.horizDistM / 1000).toFixed(1)}km`.padStart(8),
      `${d.avgGradientDeg}°`.padStart(6),
      steepStr.padEnd(18),
      rangeStr.padEnd(16),
      `${r.score}`.padStart(6),
    ].join('  ');
    console.log(row);
  });

  console.log('');
  console.log(`Showing top ${Math.min(topN, results.length)} of ${results.length} tracks with ≥${MIN_DROP_M}m descent`);
}

// ── Main ───────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const gpxOnly = args.includes('--gpx-only');
  const toursOnly = args.includes('--tours-only');
  const topIdx = args.indexOf('--top');
  const topN = topIdx >= 0 ? parseInt(args[topIdx + 1]) || 30 : 30;

  let allResults = [];

  if (!toursOnly) {
    allResults.push(...analyzeGpxTracks());
  }

  if (!gpxOnly) {
    try {
      const tourResults = await analyzeToppturTours();
      allResults.push(...tourResults);
    } catch (err) {
      console.error('Failed to fetch topptur.guide:', err.message);
    }
  }

  // Sort by score (best first)
  allResults.sort((a, b) => b.score - a.score);

  printTable(allResults, topN);

  // Write JSON output
  const outPath = path.join(repoRoot, 'descent-analysis.json');
  fs.writeFileSync(outPath, JSON.stringify(allResults, null, 2) + '\n', 'utf-8');
  console.log(`\nWritten: descent-analysis.json (${allResults.length} entries)`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
