// Persistent Torrent Archive Manager
// Maintains an archive of metadata and .torrent files in ~/.svorrent/archive
// so that any download left halfway on disk can be automatically identified
// and resumed with 1 click, even if session.json was cleared or corrupted.

import fs from 'node:fs';
import path from 'node:path';

export class TorrentArchive {
  constructor(dataDir) {
    this.archiveDir = path.join(dataDir, 'archive');
    if (!fs.existsSync(this.archiveDir)) {
      fs.mkdirSync(this.archiveDir, { recursive: true });
    }
  }

  // Save torrent metadata & .torrent file into archive
  save(torrent) {
    if (!torrent || !torrent.infoHash) return;
    const infoHash = torrent.infoHash.toLowerCase();

    const meta = {
      infoHash,
      name: torrent.name || 'Unknown',
      magnetURI: torrent.magnetURI,
      path: torrent.path,
      length: torrent.length || 0,
      pieceLength: torrent.pieceLength || 0,
      numPieces: torrent.pieces ? torrent.pieces.length : 0,
      files: (torrent.files || []).map((f) => ({
        name: f.name,
        path: f.path,
        length: f.length,
      })),
      savedAt: Date.now(),
    };

    const jsonPath = path.join(this.archiveDir, `${infoHash}.json`);
    try {
      fs.writeFileSync(jsonPath, JSON.stringify(meta, null, 2));
    } catch (err) {
      console.warn(`[archive] Failed to save meta for ${infoHash}:`, err.message);
    }

    if (torrent.torrentFile) {
      const torrentPath = path.join(this.archiveDir, `${infoHash}.torrent`);
      try {
        fs.writeFileSync(torrentPath, torrent.torrentFile);
      } catch (err) {
        console.warn(`[archive] Failed to save .torrent file for ${infoHash}:`, err.message);
      }
    }
  }

  // List all archived torrent records
  getAll() {
    try {
      const files = fs.readdirSync(this.archiveDir);
      const list = [];
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const content = fs.readFileSync(path.join(this.archiveDir, file), 'utf8');
            const parsed = JSON.parse(content);
            if (parsed && parsed.infoHash) {
              const hasTorrentFile = fs.existsSync(path.join(this.archiveDir, `${parsed.infoHash}.torrent`));
              list.push({ ...parsed, hasTorrentFile });
            }
          } catch {}
        }
      }
      return list;
    } catch {
      return [];
    }
  }

  // Get specific archived record
  get(infoHash) {
    if (!infoHash) return null;
    const jsonPath = path.join(this.archiveDir, `${infoHash.toLowerCase()}.json`);
    if (!fs.existsSync(jsonPath)) return null;
    try {
      const content = fs.readFileSync(jsonPath, 'utf8');
      const parsed = JSON.parse(content);
      const torrentPath = path.join(this.archiveDir, `${parsed.infoHash}.torrent`);
      let torrentBuffer = null;
      if (fs.existsSync(torrentPath)) {
        torrentBuffer = fs.readFileSync(torrentPath);
      }
      return { ...parsed, torrentBuffer };
    } catch {
      return null;
    }
  }

  // Match a local file or directory name from disk to a known archived torrent
  findMatchForDiskItem(itemName) {
    if (!itemName) return null;
    const lowerItem = itemName.toLowerCase().trim();
    const all = this.getAll();

    for (const entry of all) {
      // 1. Direct match on torrent name
      if (entry.name && entry.name.toLowerCase().trim() === lowerItem) {
        return entry;
      }
      // 2. Direct match on any file inside the torrent
      if (Array.isArray(entry.files)) {
        for (const f of entry.files) {
          const fName = (f.name || '').toLowerCase().trim();
          const fPath = (f.path || '').toLowerCase().trim();
          if (fName === lowerItem || fPath === lowerItem || fPath.startsWith(`${lowerItem}/`)) {
            return entry;
          }
        }
      }
    }

    return null;
  }

  // Remove archive record
  remove(infoHash) {
    if (!infoHash) return;
    const h = infoHash.toLowerCase();
    try { fs.unlinkSync(path.join(this.archiveDir, `${h}.json`)); } catch {}
    try { fs.unlinkSync(path.join(this.archiveDir, `${h}.torrent`)); } catch {}
  }
}
