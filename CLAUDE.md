# Randonee Overlay

## Project Overview
Tampermonkey userscript that overlays a GPX track on the Leaflet map at topptur.guide.

## Tech Stack
- Target site: topptur.guide (Leaflet map, `window.L` global)
- Userscript: Plain JavaScript, Tampermonkey-compatible
- Build: Node.js scripts (no framework)
- Dev server: Node.js built-in http module

## Key Files
- `gpx-overlay.user.js` — Main userscript (Tampermonkey-installable)
- `scripts/convert-gpx.js` — Converts GPX → embedded coordinates in userscript
- `serve.js` — Local dev server for GPX files
- `activity_*.gpx` — Source GPX file

## Commands
- `node scripts/convert-gpx.js` — Build self-contained userscript to `dist/`
- `node serve.js` — Start local dev server on port 3456
- `npm start` — Alias for serve.js

## Architecture Decision
Userscript approach (Tampermonkey) chosen because:
- topptur.guide uses Leaflet with `window.L` globally accessible
- Userscript can intercept `L.Map.prototype.initialize` at document-start to capture map instance
- No build toolchain required for basic usage
- GPX coordinates embedded directly for zero-dependency operation
