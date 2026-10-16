// Local Download Folder Scanner & Orphan/Halfway Download Detection
// Scans ~/Downloads/Svorrent to detect existing files, partial/abandoned downloads,
// and correlates them against active WebTorrent instances and archived metadata.

import fs from 'node:fs';
import path from 'node:path';

const IGNORED_FILES = new Set(['.ds_store', 'desktop.ini', 'thumbs.db', '.localized', '.git']);

function getDirectorySize(dirPath) {
  let total = 0;
  let fileCount = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED_FILES.has(entry.name.toLowerCase())) continue;
      const fullPath = path.join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          const sub = getDirectorySize(fullPath);
          total += sub.total;
          fileCount += sub.fileCount;
        } else if (entry.isFile()) {
          const st = fs.statSync(fullPath);
          total += st.size;
          fileCount++;
        }
      } catch {}
    }
  } catch {}
  return { total, fileCount };
}

export class FolderScanner {
  constructor(downloadDir, clientProvider, archiveProvider) {
    this.downloadDir = downloadDir;
    this.getClient = clientProvider;
    this.getArchive = archiveProvider;
    this._cachedResult = null;
    this._lastScanTime = 0;
    this.CACHE_TTL_MS = 2500;
  }

  invalidateCache() {
    this._cachedResult = null;
    this._lastScanTime = 0;
  }

  scan(force = false) {
    const now = Date.now();
    if (!force && this._cachedResult && (now - this._lastScanTime) < this.CACHE_TTL_MS) {
      return this._cachedResult;
    }

    if (!fs.existsSync(this.downloadDir)) {
      const emptyResult = {
        downloadDir: this.downloadDir,
        items: [],
        totalSizeOnDisk: 0,
        orphanCount: 0,
        recoverableCount: 0,
      };
      this._cachedResult = emptyResult;
      this._lastScanTime = now;
      return emptyResult;
    }

    const client = this.getClient();
    const activeTorrents = client?.torrents ? client.torrents.filter((t) => !t.destroyed) : [];
    const archive = this.getArchive();

    let entries = [];
    try {
      entries = fs.readdirSync(this.downloadDir, { withFileTypes: true });
    } catch (err) {
      console.warn('[scanner] Failed to read download dir:', err.message);
      return {
        downloadDir: this.downloadDir,
        items: [],
        totalSizeOnDisk: 0,
        orphanCount: 0,
        recoverableCount: 0,
      };
    }

    const items = [];
    let totalSizeOnDisk = 0;
    let orphanCount = 0;
    let recoverableCount = 0;

    for (const entry of entries) {
      if (IGNORED_FILES.has(entry.name.toLowerCase())) continue;

      const fullPath = path.join(this.downloadDir, entry.name);
      let sizeOnDisk = 0;
      let mtime = 0;
      let isDirectory = false;
      let innerFileCount = 1;

      try {
        const stat = fs.statSync(fullPath);
        mtime = stat.mtimeMs;
        isDirectory = stat.isDirectory();
        if (isDirectory) {
          const dirInfo = getDirectorySize(fullPath);
          sizeOnDisk = dirInfo.total;
          innerFileCount = dirInfo.fileCount;
        } else {
          sizeOnDisk = stat.size;
        }
      } catch {
        continue;
      }

      totalSizeOnDisk += sizeOnDisk;

      // 1. Check if active in client
      const activeMatch = activeTorrents.find((t) => {
        if (t.name && t.name.toLowerCase() === entry.name.toLowerCase()) return true;
        if (Array.isArray(t.files)) {
          return t.files.some((f) => {
            const fName = (f.name || '').toLowerCase();
            const fPath = (f.path || '').toLowerCase();
            return fName === entry.name.toLowerCase() || fPath.startsWith(entry.name.toLowerCase());
          });
        }
        return false;
      });

      if (activeMatch) {
        items.push({
          name: entry.name,
          path: entry.name,
          absolutePath: fullPath,
          sizeOnDisk,
          mtime,
          isDirectory,
          innerFileCount,
          status: 'active',
          torrent: {
            infoHash: activeMatch.infoHash,
            name: activeMatch.name,
            progress: activeMatch.progress || 0,
            downloadSpeed: activeMatch.downloadSpeed || 0,
            done: !!activeMatch.done,
            paused: !!(activeMatch.paused || activeMatch._pausedManually),
            length: activeMatch.length || 0,
          },
        });
        continue;
      }

      // 2. Check if recoverable via archive
      const archiveMatch = archive ? archive.findMatchForDiskItem(entry.name) : null;
      if (archiveMatch) {
        orphanCount++;
        recoverableCount++;
        const totalLength = archiveMatch.length || 0;
        const estimatedProgress = totalLength > 0 ? Math.min(100, Math.round((sizeOnDisk / totalLength) * 100)) : 0;

        items.push({
          name: entry.name,
          path: entry.name,
          absolutePath: fullPath,
          sizeOnDisk,
          mtime,
          isDirectory,
          innerFileCount,
          status: 'recoverable',
          recoverable: {
            infoHash: archiveMatch.infoHash,
            name: archiveMatch.name,
            totalLength,
            estimatedProgress,
            magnetURI: archiveMatch.magnetURI,
            hasTorrentFile: !!archiveMatch.hasTorrentFile,
            files: archiveMatch.files || [],
            savedAt: archiveMatch.savedAt,
          },
        });
        continue;
      }

      // 3. Untracked file/folder
      orphanCount++;
      items.push({
        name: entry.name,
        path: entry.name,
        absolutePath: fullPath,
        sizeOnDisk,
        mtime,
        isDirectory,
        innerFileCount,
        status: 'untracked',
      });
    }

    // Sort: recoverable first, then untracked, then active; newest modified first
    const statusOrder = { recoverable: 0, untracked: 1, active: 2 };
    items.sort((a, b) => {
      const diff = (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3);
      if (diff !== 0) return diff;
      return b.mtime - a.mtime;
    });

    const result = {
      downloadDir: this.downloadDir,
      items,
      totalSizeOnDisk,
      orphanCount,
      recoverableCount,
    };
    this._cachedResult = result;
    this._lastScanTime = now;
    return result;
  }

  deleteItem(name) {
    if (!name) throw new Error('File name is required');
    const safeName = path.basename(name);
    const target = path.join(this.downloadDir, safeName);
    if (!fs.existsSync(target)) throw new Error('File not found on disk');

    fs.rmSync(target, { recursive: true, force: true });
    this.invalidateCache();
    return { success: true, deleted: safeName };
  }
}
