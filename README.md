# Randonee Overlay

A Tampermonkey userscript that overlays a GPX track on the [topptur.guide](https://topptur.guide) backcountry ski map.

## Quick Start

### Option A: Self-contained userscript (recommended)

1. Build the userscript with your GPX file embedded:
   ```bash
   node scripts/convert-gpx.js
   ```
2. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser.
3. Open `dist/topptur-gpx-overlay.user.js` in your browser — Tampermonkey will prompt to install it.
4. Navigate to [topptur.guide](https://topptur.guide/#16/69.8696/19.3808) — the track appears on the map.

### Option B: Dev server mode (for iterating)

1. Start the local dev server:
   ```bash
   node serve.js
   ```
2. In `gpx-overlay.user.js`, change the `GPX_URL` line:
   ```js
   const GPX_URL = 'http://localhost:3456/activity_21956037260.gpx';
   ```
3. Install `gpx-overlay.user.js` in Tampermonkey (drag into browser or use Dashboard → + → paste).
4. Navigate to topptur.guide — the GPX is fetched at runtime from your local server.

## UI Controls

| Button | Action |
|--------|--------|
| **GPX Track** | Toggle the track overlay on/off |
| **Fit to Track** | Zoom the map to fit the entire track |

The track is drawn with a red polyline. Green dot = start, red dot = end.

## Replacing the GPX File

1. Place your new `.gpx` file in the repo root (or anywhere accessible).
2. Rebuild:
   ```bash
   node scripts/convert-gpx.js path/to/your-file.gpx
   ```
3. Reinstall `dist/topptur-gpx-overlay.user.js` in Tampermonkey.

If using dev server mode, just drop the file in the repo root and update `GPX_URL`.

## Customizing Track Style

Edit the configuration at the top of `gpx-overlay.user.js`:

```js
const TRACK_COLOR = '#ff3300';  // Any CSS color
const TRACK_WEIGHT = 4;         // Line width in pixels
const TRACK_OPACITY = 0.85;     // 0 to 1
```

## How It Works

- **Target site**: topptur.guide uses [Leaflet](https://leafletjs.com/) with `window.L` as a global.
- **Approach**: The userscript intercepts `L.Map.prototype.initialize` at `document-start` to capture the map instance before the app creates it. Once the map is ready, it adds a polyline layer with the GPX coordinates.
- **GPX loading**: Either embedded directly in the script (via `npm run build`) or fetched at runtime using `GM_xmlhttpRequest` (which bypasses CORS).

## Project Structure

```
gpx-overlay.user.js       Template userscript (edit config here)
scripts/convert-gpx.js    Builds self-contained userscript with embedded coords
serve.js                  Local dev server for GPX files
dist/                     Built userscript output
activity_*.gpx            Source GPX file(s)
```

## Manual Test Plan

1. Install the userscript in Tampermonkey.
2. Open https://topptur.guide/#16/69.8696/19.3808
3. Verify: red track line appears on the map.
4. Verify: green dot at track start, red dot at track end.
5. Click "GPX Track" button → track hides. Click again → track shows.
6. Click "Fit to Track" → map zooms to show the entire track.
7. Pan/zoom the underlying map — track stays aligned.
