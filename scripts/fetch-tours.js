#!/usr/bin/env node
/**
 * Fetches the topptur.guide tour database and saves it as a local JSON file.
 *
 * The tours are embedded in a JS module on topptur.guide. This script:
 * 1. Discovers the current tours file hash from the index page
 * 2. Downloads and parses the tours JS module
 * 3. Filters to Tromsø area (within ~90min drive)
 * 4. Computes stats (ascent, distance, max elevation) per tour
 * 5. Saves as topptur-tours.json for use by recommend.html
 *
 * Usage: node scripts/fetch-tours.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const TROMSO = { lat: 69.6492, lon: 18.9553 };
const BBOX = { minLat: 69.3, maxLat: 70.0, minLon: 18.0, maxLon: 20.5 };
const MAX_DRIVE_KM = 65;

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

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function main() {
  console.log('Fetching topptur.guide index page...');
  const pageHtml = await httpsGet('https://topptur.guide/');

  const indexMatch = pageHtml.match(/src="\/assets\/index\.([A-Za-z0-9_-]+)\.js"/);
  if (!indexMatch) throw new Error('Could not find index.js reference in page');
  console.log(`Found index bundle: index.${indexMatch[1]}.js`);

  console.log('Fetching index bundle to discover tours file...');
  const indexJs = await httpsGet(`https://topptur.guide/assets/index.${indexMatch[1]}.js`);

  const toursMatch = indexJs.match(/tours\.([A-Za-z0-9_-]+)\.js/);
  if (!toursMatch) throw new Error('Could not find tours.js reference in bundle');
  console.log(`Found tours file: tours.${toursMatch[1]}.js`);

  console.log('Fetching tours data...');
  const toursJs = await httpsGet(`https://topptur.guide/assets/tours.${toursMatch[1]}.js`);

  // Evaluate the JS module to get the tours array
  // Format: const e=JSON.parse(`...`);export{e as default}
  const cleanJs = toursJs.replace(/;?\s*export\s*\{[^}]*\}\s*;?\s*$/, '');
  const allTours = new Function(cleanJs + '; return e;')();
  console.log(`Parsed ${allTours.length} total tours`);

  // Filter to Tromsø area
  const tromsøTours = allTours.filter(t => {
    if (!t.coordinates || t.coordinates.length === 0) return false;
    const [lon, lat] = t.coordinates[0];
    return lat >= BBOX.minLat && lat <= BBOX.maxLat &&
           lon >= BBOX.minLon && lon <= BBOX.maxLon;
  });
  console.log(`${tromsøTours.length} tours in Tromsø area`);

  // Compute stats and slim down the data
  const output = tromsøTours.map(t => {
    const coords = t.coordinates;
    let ascent = 0, distance = 0, maxEle = -Infinity;
    const startLon = coords[0][0], startLat = coords[0][1];

    for (let i = 0; i < coords.length; i++) {
      const ele = coords[i][2] || 0;
      if (ele > maxEle) maxEle = ele;
      if (i === 0) continue;
      const [lon1, lat1, e1] = coords[i - 1];
      const [lon2, lat2, e2] = coords[i];
      distance += haversineKm(lat1, lon1, lat2, lon2);
      const delta = (e2 || 0) - (e1 || 0);
      if (delta > 0) ascent += delta;
    }

    const distFromTromso = haversineKm(TROMSO.lat, TROMSO.lon, startLat, startLon);

    return {
      id: t.id,
      name: t.name,
      ates: t.ates,
      description: t.description,
      place: t.place,
      county: t.county,
      startLat, startLon,
      ascent: Math.round(ascent),
      distance: Math.round(distance * 10) / 10,
      maxEle: Math.round(maxEle),
      distFromTromso: Math.round(distFromTromso * 10) / 10,
    };
  }).filter(t => t.distFromTromso <= MAX_DRIVE_KM);

  console.log(`${output.length} tours within ${MAX_DRIVE_KM}km of Tromsø`);

  const outPath = path.join(__dirname, '..', 'topptur-tours.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n', 'utf-8');
  console.log(`Written: topptur-tours.json (${output.length} tours, ${(Buffer.byteLength(JSON.stringify(output)) / 1024).toFixed(1)} KB)`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
