#!/usr/bin/env node
/**
 * Syncs GPX activities from Garmin Connect.
 *
 * Downloads new activities of type "other" (ski touring) as GPX files
 * into tracks/ and updates tracks.json.
 *
 * Auth: Set GARMIN_EMAIL and GARMIN_PASSWORD environment variables.
 * Tokens are cached in .garmin-tokens/ to avoid re-authenticating each run.
 *
 * Usage: node scripts/sync-garmin.js [--all]
 *   --all   Re-check all activities (default: fetch latest 20)
 */

const { GarminConnect } = require('garmin-connect');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const tracksDir = path.join(repoRoot, 'tracks');
const tokenDir = path.join(repoRoot, '.garmin-tokens');
const manifestPath = path.join(repoRoot, 'tracks.json');

const ACTIVITY_TYPE = 'other';
const FETCH_LIMIT = 20;

async function main() {
  const fetchAll = process.argv.includes('--all');
  const email = process.env.GARMIN_EMAIL;
  const password = process.env.GARMIN_PASSWORD;

  if (!email || !password) {
    console.error('Set GARMIN_EMAIL and GARMIN_PASSWORD environment variables.');
    process.exit(1);
  }

  // Ensure directories exist
  if (!fs.existsSync(tracksDir)) fs.mkdirSync(tracksDir, { recursive: true });
  if (!fs.existsSync(tokenDir)) fs.mkdirSync(tokenDir, { recursive: true });

  // Get existing activity IDs from tracks/
  const existingIds = new Set(
    fs.readdirSync(tracksDir)
      .filter(f => f.endsWith('.gpx'))
      .map(f => f.replace(/^activity_/, '').replace(/\.gpx$/, ''))
  );
  console.log(`Found ${existingIds.size} existing track(s) in tracks/`);

  // Initialize Garmin client
  const client = new GarminConnect({ username: email, password: password });

  // Try to restore tokens
  try {
    client.loadTokenByFile(tokenDir);
    console.log('Restored saved session tokens');
  } catch {
    // No saved tokens, will do full login
  }

  // Login
  try {
    console.log('Logging in to Garmin Connect...');
    await client.login();
    console.log('Login successful');
    // Save tokens for next run
    client.exportTokenToFile(tokenDir);
  } catch (err) {
    console.error('Login failed:', err.message);
    process.exit(1);
  }

  // Fetch activities
  let activities;
  try {
    if (fetchAll) {
      console.log('Fetching all activities of type "other"...');
      // Fetch in batches
      activities = [];
      let start = 0;
      const batchSize = 50;
      while (true) {
        const batch = await client.getActivities(start, batchSize, ACTIVITY_TYPE);
        if (!batch || batch.length === 0) break;
        activities.push(...batch);
        start += batchSize;
        if (batch.length < batchSize) break;
      }
    } else {
      console.log(`Fetching latest ${FETCH_LIMIT} activities of type "other"...`);
      activities = await client.getActivities(0, FETCH_LIMIT, ACTIVITY_TYPE);
    }
  } catch (err) {
    console.error('Failed to fetch activities:', err.message);
    process.exit(1);
  }

  if (!activities || activities.length === 0) {
    console.log('No activities found.');
    return;
  }

  console.log(`Found ${activities.length} activity/activities on Garmin Connect`);

  // Filter to new activities
  const newActivities = activities.filter(a => !existingIds.has(String(a.activityId)));

  if (newActivities.length === 0) {
    console.log('All activities already downloaded. Nothing to sync.');
    return;
  }

  console.log(`Downloading ${newActivities.length} new activity/activities...`);

  let downloaded = 0;
  for (const activity of newActivities) {
    const id = activity.activityId;
    const name = activity.activityName || `Activity ${id}`;
    try {
      await client.downloadOriginalActivityData({ activityId: id }, tracksDir, 'gpx');
      // The file is saved as {activityId}.gpx, rename to activity_{activityId}.gpx
      const srcFile = path.join(tracksDir, `${id}.gpx`);
      const destFile = path.join(tracksDir, `activity_${id}.gpx`);
      if (fs.existsSync(srcFile)) {
        fs.renameSync(srcFile, destFile);
      }
      downloaded++;
      console.log(`  [${downloaded}/${newActivities.length}] ${name} (${id})`);
    } catch (err) {
      console.warn(`  Failed to download ${name} (${id}): ${err.message}`);
    }
  }

  console.log(`\nDownloaded ${downloaded} new GPX file(s)`);

  // Update tracks.json manifest
  const allFiles = fs.readdirSync(tracksDir)
    .filter(f => f.endsWith('.gpx'))
    .sort();
  fs.writeFileSync(manifestPath, JSON.stringify(allFiles, null, 2) + '\n', 'utf-8');
  console.log(`Updated tracks.json (${allFiles.length} track(s))`);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
