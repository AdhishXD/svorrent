// Download session persistence.
//
// Saves every permanent download (with its .torrent metadata and verified
// piece bitfield) so that after a restart downloads resume instantly:
//   - no waiting for metadata from the swarm (the info dict is stored)
//   - no full re-hash of existing data (the bitfield is trusted, with
//     WebTorrent spot-checking a couple of pieces per file)

import fs from 'node:fs';
import path from 'node:path';

export function createSession(dataDir) {
  const file = path.join(dataDir, 'session.json');
  fs.mkdirSync(dataDir, { recursive: true });

  const load = () => {
    try {
      const entries = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Array.isArray(entries) ? entries : [];
    } catch {
      return [];
    }
  };

  const save = (torrents) => {
    const entries = torrents
      .filter((t) => t._isPermanentDownload && !t.destroyed)
      .map((t) => ({
        infoHash: t.infoHash,
        magnet: t.magnetURI,
        name: t.name,
        path: t.path,
        paused: !!t._pausedManually,
        addedAt: t._addedAt || Date.now(),
        torrentFile: t.torrentFile ? Buffer.from(t.torrentFile).toString('base64') : null,
        bitfield: t.ready && t.bitfield ? Buffer.from(t.bitfield.buffer).toString('base64') : null,
      }));

    // Write atomically so a crash mid-write never corrupts the session.
    const tmp = `${file}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(entries));
      fs.renameSync(tmp, file);
    } catch (err) {
      console.warn('[session] save failed:', err.message);
    }
  };

  return { load, save };
}
