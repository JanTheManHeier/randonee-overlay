#!/usr/bin/env node
/**
 * Dev server that serves GPX files from tracks/ and provides a JSON API.
 *
 * Endpoints:
 *   GET /tracks.json   — JSON manifest of available GPX files
 *   GET /tracks/*.gpx  — individual GPX files
 *   GET /api/tracks    — (legacy) same as tracks.json
 *
 * Usage: node serve.js [port]
 * Default port: 3456
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.argv[2] || '3456', 10);
const ROOT = __dirname;
const TRACKS_DIR = path.join(ROOT, 'tracks');

const MIME_TYPES = {
  '.gpx': 'application/gpx+xml',
  '.xml': 'application/xml',
  '.json': 'application/json',
  '.js': 'application/javascript',
  '.html': 'text/html',
};

function listGpxFiles() {
  if (!fs.existsSync(TRACKS_DIR)) return [];
  return fs.readdirSync(TRACKS_DIR).filter(f => f.endsWith('.gpx')).sort();
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const urlPath = decodeURIComponent(req.url.split('?')[0]);

  // JSON API: list tracks
  if (urlPath === '/api/tracks') {
    const files = listGpxFiles();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(files));
    return;
  }

  // Serve files from repo root
  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      if (urlPath === '/') {
        const files = listGpxFiles();
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<html><body>
          <h2>GPX Dev Server</h2>
          <p>${files.length} track(s) in tracks/:</p>
          <ul>${files.map(f => `<li><a href="/tracks/${f}">${f}</a></li>`).join('')}</ul>
          <p>API: <a href="/api/tracks">/api/tracks</a></p>
        </body></html>`);
        return;
      }
      res.writeHead(404); res.end('Not found'); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  const files = listGpxFiles();
  // Auto-generate tracks.json so the dev server matches the GitHub Pages format
  const manifestPath = path.join(ROOT, 'tracks.json');
  fs.writeFileSync(manifestPath, JSON.stringify(files, null, 2) + '\n', 'utf-8');
  console.log(`GPX dev server running at http://localhost:${PORT}`);
  console.log(`${files.length} track(s) in tracks/`);
  console.log(`Manifest: http://localhost:${PORT}/tracks.json`);
});
