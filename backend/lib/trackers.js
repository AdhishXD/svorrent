// Tracker list management.
//
// Many magnets from public indexes carry trackers that died years ago. More
// working trackers = more peers found sooner = faster ramp-up. We ship a
// static list of long-lived trackers and refresh it from the community
// maintained ngosang/trackerslist once a day (cached on disk).

import fs from 'node:fs';
import path from 'node:path';

const BEST_LIST_URL = 'https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_best.txt';
const REFRESH_MS = 24 * 60 * 60 * 1000;

export const STATIC_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://tracker.qu.ax:6969/announce',
  'udp://opentracker.io:6969/announce',
  'udp://open.tracker.cl:1337/announce',
  'udp://tracker-udp.gbitt.info:80/announce',
  'udp://tracker.tiny-vps.com:6969/announce',
  'http://tracker.opentrackr.org:1337/announce',
];

function isUsable(url) {
  // Node has no WebRTC, so ws/wss trackers only add overhead.
  return /^(udp|https?):\/\//i.test(url);
}

/**
 * Returns a live array that is updated in place when a fresher list is
 * fetched, so it can be handed straight to WebTorrent's `tracker.announce`.
 */
export function createTrackerList(cacheDir) {
  const list = [...STATIC_TRACKERS];
  const cacheFile = path.join(cacheDir, 'trackers.json');

  const merge = (urls) => {
    for (const url of urls) {
      const clean = url.trim();
      if (clean && isUsable(clean) && !list.includes(clean)) list.push(clean);
    }
  };

  let cachedAt = 0;
  try {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    merge(cached.trackers || []);
    cachedAt = cached.fetchedAt || 0;
  } catch {
    /* no cache yet */
  }

  const refresh = async () => {
    try {
      const res = await fetch(BEST_LIST_URL, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const urls = (await res.text()).split(/\s+/).filter(isUsable);
      if (urls.length === 0) return;
      merge(urls);
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify({ fetchedAt: Date.now(), trackers: urls }, null, 2));
      console.log(`[trackers] refreshed: ${list.length} trackers available`);
    } catch (err) {
      console.warn(`[trackers] refresh failed (${err.message}); using ${list.length} cached/static trackers`);
    }
  };

  if (Date.now() - cachedAt > REFRESH_MS) refresh();
  setInterval(refresh, REFRESH_MS).unref();

  return list;
}
