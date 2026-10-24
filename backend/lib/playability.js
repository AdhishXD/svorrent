import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { childPath } from './safe-path.js';

// Common playable video container extensions
export const VIDEO_EXTENSIONS = new Set([
  '.mkv', '.mp4', '.avi', '.mov', '.m4v', '.webm', '.ts', '.flv', '.wmv', '.vob', '.ogv', '.m2ts'
]);

// Cache for probed video metadata: filePath -> { duration: seconds, bitrate: bits/s, probedAt: timestamp }
const metaCache = new Map();
const inFlightProbes = new Set();
const probeAttempts = new Map();

/**
 * Locate ffprobe binary on the host system.
 */
export function findFfprobe() {
  const candidates = [
    'ffprobe',
    '/opt/homebrew/bin/ffprobe',
    '/usr/local/bin/ffprobe',
    '/usr/bin/ffprobe',
  ];
  for (const c of candidates) {
    if (c === 'ffprobe') continue;
    if (fs.existsSync(c)) return c;
  }
  return 'ffprobe';
}

/**
 * Format bytes into human readable format.
 */
export function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

// Cache for smoothed speed calculation: torrentKey -> { ema: number, lastUpdate: number }
const torrentSpeedEma = new Map();

/**
 * Format duration/eta in seconds into human readable format (e.g. 45s, 14m, 1h 22m, 2d 4h).
 */
export function formatEta(seconds) {
  if (!seconds || seconds <= 0 || !isFinite(seconds)) return '0s';
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  if (hours < 24) {
    const mins = Math.ceil((seconds % 3600) / 60);
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

/**
 * Fallback duration estimate when ffprobe is not available or metadata hasn't parsed.
 */
export function estimateDuration(fileLength) {
  if (!fileLength || fileLength <= 0) return 5400; // default 90m
  // 4K UHD Remux (> 25 GB): ~45 Mbps average (~5.6 MB/s)
  if (fileLength > 25 * 1024 * 1024 * 1024) {
    return Math.max(3600, Math.min(14400, Math.round(fileLength / (5.6 * 1024 * 1024))));
  }
  // 1080p high bitrate (4 - 25 GB): ~10 Mbps average (~1.25 MB/s)
  if (fileLength > 4 * 1024 * 1024 * 1024) {
    return Math.max(3600, Math.min(10800, Math.round(fileLength / (1.25 * 1024 * 1024))));
  }
  // Compressed / Web (< 4 GB): ~3.5 Mbps average (~0.44 MB/s)
  return Math.max(1800, Math.min(7200, Math.round(fileLength / (0.44 * 1024 * 1024))));
}

/**
 * Check if the MP4 moov atom is located near the start of the file (faststart).
 */
export function hasMoovAtBeginning(filePath, maxScanBytes = 8 * 1024 * 1024) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return false;
    const fd = fs.openSync(filePath, 'r');
    const stat = fs.fstatSync(fd);
    const toRead = Math.min(stat.size, maxScanBytes);
    if (toRead < 32) {
      fs.closeSync(fd);
      return false;
    }
    const buf = Buffer.alloc(toRead);
    fs.readSync(fd, buf, 0, toRead, 0);
    fs.closeSync(fd);
    return buf.includes('moov');
  } catch {
    return false;
  }
}

/**
 * Trigger asynchronous ffprobe extraction to determine real container runtime.
 */
export function probeMediaAsync(filePath) {
  if (!filePath || !fs.existsSync(filePath) || inFlightProbes.has(filePath)) return;
  if (metaCache.has(filePath)) return;
  if (inFlightProbes.size >= 2 || Date.now() - (probeAttempts.get(filePath) || 0) < 30000) return;

  probeAttempts.set(filePath, Date.now());
  if (probeAttempts.size > 1000) probeAttempts.delete(probeAttempts.keys().next().value);
  inFlightProbes.add(filePath);
  const ffprobePath = findFfprobe();

  execFile(
    ffprobePath,
    ['-v', 'error', '-show_entries', 'format=duration,bit_rate', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
    { timeout: 4000 },
    (err, stdout) => {
      inFlightProbes.delete(filePath);
      if (err || !stdout) return;

      const lines = stdout.trim().split('\n');
      const duration = parseFloat(lines[0]);
      const bitrate = parseFloat(lines[1]) || 0;

      if (duration && duration > 0 && !isNaN(duration)) {
        metaCache.set(filePath, {
          duration,
          bitrate,
          probedAt: Date.now(),
        });
      }
    }
  );
}

/**
 * Locate the primary video file within an active WebTorrent instance.
 */
export function findPrimaryVideoInTorrent(torrent, downloadDir) {
  if (!torrent || !torrent.files || torrent.files.length === 0) return null;

  const basePath = torrent.path ? torrent.path : downloadDir;
  const videoFiles = torrent.files.filter((f) => {
    const ext = path.extname(f.name || '').toLowerCase();
    return VIDEO_EXTENSIONS.has(ext);
  });

  if (videoFiles.length === 0) return null;

  // Choose the largest video file (main film / episode)
  const largest = videoFiles.reduce((a, b) => ((a.length || 0) > (b.length || 0) ? a : b));
  const fullPath = childPath(basePath, largest.path || largest.name);
  if (!fullPath) return null;

  return {
    file: largest,
    fullPath,
    name: largest.name,
    length: largest.length || torrent.length || 0,
    downloaded: typeof largest.downloaded === 'number' ? largest.downloaded : (torrent.downloaded || 0),
  };
}

// Cache for directory primary video lookups: key -> { result, cachedAt }
const folderPrimaryVideoCache = new Map();

/**
 * Locate the primary video file in a local folder scanner item.
 */
export function findPrimaryVideoInFolder(item) {
  if (!item || !item.absolutePath) return null;

  // Single file item
  if (item.type === 'file' || item.isDirectory === false) {
    const ext = path.extname(item.name || '').toLowerCase();
    if (!VIDEO_EXTENSIONS.has(ext)) return null;
    return {
      fullPath: item.absolutePath,
      name: item.name,
      length: item.sizeOnDisk || 0,
      downloaded: item.sizeOnDisk || 0,
    };
  }

  // Directory item: check cache first
  const cacheKey = item.absolutePath;
  const cached = folderPrimaryVideoCache.get(cacheKey);
  if (cached && cached.mtime === item.mtime && (Date.now() - cached.cachedAt) < 10000) {
    return cached.result;
  }

  try {
    const candidates = [];
    function scanDir(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(full);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (VIDEO_EXTENSIONS.has(ext)) {
            try {
              const stat = fs.statSync(full);
              candidates.push({ fullPath: full, name: entry.name, length: stat.size, downloaded: stat.size });
            } catch {}
          }
        }
      }
    }
    scanDir(item.absolutePath);
    const result = candidates.length > 0
      ? candidates.reduce((a, b) => (a.length > b.length ? a : b))
      : null;

    folderPrimaryVideoCache.set(cacheKey, { result, mtime: item.mtime, cachedAt: Date.now() });
    if (folderPrimaryVideoCache.size > 1000) folderPrimaryVideoCache.delete(folderPrimaryVideoCache.keys().next().value);
    return result;
  } catch {
    return null;
  }
}

/**
 * Assess buffer-free playability for an active torrent.
 */
export function assessTorrentPlayability(torrent, downloadDir) {
  const primary = findPrimaryVideoInTorrent(torrent, downloadDir);
  if (!primary) {
    return {
      isMedia: false,
      canPlay: false,
      reason: 'No playable video in torrent',
    };
  }

  // If torrent or file is 100% complete
  const isDone = !!(torrent.done || primary.file.done);
  if (isDone && fs.existsSync(primary.fullPath)) {
    return {
      isMedia: true,
      canPlay: true,
      fileName: primary.name,
      filePath: primary.fullPath,
      progress: 1,
      reason: 'Play in VLC (Complete)',
    };
  }

  // Check if file exists on disk
  if (!fs.existsSync(primary.fullPath)) {
    return {
      isMedia: true,
      canPlay: false,
      fileName: primary.name,
      filePath: primary.fullPath,
      progress: 0,
      reason: 'Initializing download on disk…',
    };
  }

  const downloaded = Math.max(0, primary.downloaded || 0);
  const totalLength = primary.length || torrent.length || 1;
  const progressRatio = downloaded / totalLength;

  // Requirement 1: Container header safety threshold.
  // Matroska container headers are at the beginning; MP4 container moov atoms are typically at the tail.
  const minHeaderBytes = Math.min(25 * 1024 * 1024, totalLength * 0.02);
  // Download totals include unverified/out-of-order blocks. Only consecutive
  // verified pieces at this file's offset can supply playable headers.
  let bufferedBytes = 0;
  if (torrent.bitfield && torrent.pieceLength > 0) {
    const offset = primary.file.offset || 0;
    for (let piece = Math.floor(offset / torrent.pieceLength);
      piece * torrent.pieceLength < offset + totalLength && torrent.bitfield.get(piece); piece++) {
      bufferedBytes = Math.min(totalLength, (piece + 1) * torrent.pieceLength - offset);
    }
  }

  // MP4 files require the 'moov' atom to demux video/audio streams.
  // If not placed at the file head (faststart), the moov atom resides in the final pieces of the file.
  const isMp4 = ['.mp4', '.m4v', '.mov'].includes(path.extname(primary.name || '').toLowerCase());
  let tailReady = true;
  if (isMp4 && torrent.bitfield && torrent.pieceLength > 0) {
    if (!hasMoovAtBeginning(primary.fullPath)) {
      const fileOffset = typeof primary.file?.offset === 'number' ? primary.file.offset : 0;
      const lastPieceOfFile = typeof primary.file?._endPiece === 'number'
        ? primary.file._endPiece
        : Math.floor((fileOffset + totalLength - 1) / torrent.pieceLength);
      const tailPiecesCount = Math.max(2, Math.min(6, Math.ceil((20 * 1024 * 1024) / torrent.pieceLength)));
      const startTailPiece = Math.max(0, lastPieceOfFile - tailPiecesCount + 1);
      for (let p = startTailPiece; p <= lastPieceOfFile; p++) {
        if (!torrent.bitfield.get(p)) {
          tailReady = false;
          break;
        }
      }
    }
  }

  // Queue background ffprobe extraction if headers are present
  if (bufferedBytes >= minHeaderBytes && tailReady) {
    probeMediaAsync(primary.fullPath);
  }

  // Requirement 2: Continuous buffer streaming equation
  const cachedMeta = metaCache.get(primary.fullPath);
  const duration = cachedMeta?.duration || estimateDuration(totalLength);
  const isPaused = !!(torrent.paused || torrent._pausedManually);
  const rawSpeed = isPaused ? 0 : (torrent.downloadSpeed || 0);

  // Speed smoothing via exponential moving average (EMA) to damp out momentary piece-boundary drops
  const torrentKey = torrent.infoHash || torrent.name || primary.fullPath;
  let effectiveSpeed = rawSpeed;
  if (!isPaused && rawSpeed > 0) {
    const now = Date.now();
    const prev = torrentSpeedEma.get(torrentKey);
    if (prev && (now - prev.lastUpdate) < 10000) {
      const smoothed = Math.round(prev.ema * 0.7 + rawSpeed * 0.3);
      torrentSpeedEma.set(torrentKey, { ema: smoothed, lastUpdate: now });
      effectiveSpeed = Math.max(rawSpeed, smoothed);
    } else {
      torrentSpeedEma.set(torrentKey, { ema: rawSpeed, lastUpdate: now });
    }
  } else if (isPaused) {
    torrentSpeedEma.delete(torrentKey);
  }

  const safetyMargin = 1.20; // 20% safety margin against connection fluctuations

  // If download is paused
  if (isPaused) {
    const safeDownloadedTarget = Math.max(0, totalLength - (duration > 0 ? (1024 * 1024 * duration) / safetyMargin : 0));
    const headerNeeded = Math.max(0, minHeaderBytes - bufferedBytes);
    const bufferNeeded = Math.max(headerNeeded, safeDownloadedTarget - downloaded);
    return {
      isMedia: true,
      canPlay: false,
      fileName: primary.name,
      filePath: primary.fullPath,
      duration,
      progress: progressRatio,
      bufferNeeded,
      secondsUntilSafe: null,
      timeToPlay: null,
      reason: `Download paused · Resume download to estimate time to play (needs ~${formatBytes(bufferNeeded)} buffer)`,
    };
  }

  // If download is stalled or zero speed
  if (effectiveSpeed <= 0) {
    const safeDownloadedTarget = Math.max(0, totalLength - (duration > 0 ? (1024 * 1024 * duration) / safetyMargin : 0));
    const headerNeeded = Math.max(0, minHeaderBytes - bufferedBytes);
    const bufferNeeded = Math.max(headerNeeded, safeDownloadedTarget - downloaded);
    return {
      isMedia: true,
      canPlay: false,
      fileName: primary.name,
      filePath: primary.fullPath,
      duration,
      progress: progressRatio,
      bufferNeeded,
      secondsUntilSafe: null,
      timeToPlay: null,
      reason: `Waiting for peers · Need ~${formatBytes(bufferNeeded)} buffer to stream without buffering`,
    };
  }

  const remainingBytes = Math.max(0, totalLength - downloaded);
  const etaSeconds = remainingBytes / effectiveSpeed;
  const headersReady = (bufferedBytes >= minHeaderBytes) && tailReady;

  // Physical Condition: Download ETA with 20% margin <= Total Video Runtime
  if (headersReady && (etaSeconds * safetyMargin <= duration)) {
    return {
      isMedia: true,
      canPlay: true,
      fileName: primary.name,
      filePath: primary.fullPath,
      duration,
      progress: progressRatio,
      secondsUntilSafe: 0,
      timeToPlay: '0s',
      reason: 'Play in VLC (Safe to stream without buffering)',
    };
  }

  // Calculate buffer required to reach the safe streaming threshold
  const safeDownloadedTarget = Math.max(0, totalLength - (effectiveSpeed * duration) / safetyMargin);
  const headerNeeded = Math.max(0, minHeaderBytes - bufferedBytes);
  const streamingBufferNeeded = Math.max(0, safeDownloadedTarget - downloaded);
  const bufferNeeded = Math.max(headerNeeded, streamingBufferNeeded);
  const secondsUntilSafe = Math.ceil(bufferNeeded / effectiveSpeed);
  const timeFormatted = formatEta(secondsUntilSafe);

  // If MP4 container index at the tail is still missing
  if (!tailReady) {
    const tailBufferNeeded = Math.min(25 * 1024 * 1024, totalLength * 0.02);
    const secSafe = Math.ceil(tailBufferNeeded / Math.max(1, effectiveSpeed));
    return {
      isMedia: true,
      canPlay: false,
      fileName: primary.name,
      filePath: primary.fullPath,
      duration,
      progress: progressRatio,
      bufferNeeded: tailBufferNeeded,
      secondsUntilSafe: secSafe,
      timeToPlay: formatEta(secSafe),
      reason: 'Buffering MP4 index (downloading index at end of file…)',
    };
  }

  // If headers are still buffering
  if (!headersReady) {
    return {
      isMedia: true,
      canPlay: false,
      fileName: primary.name,
      filePath: primary.fullPath,
      duration,
      progress: progressRatio,
      bufferNeeded,
      secondsUntilSafe,
      timeToPlay: timeFormatted,
      reason: `Buffering headers · Estimated time to play: ~${timeFormatted} (need ${formatBytes(bufferNeeded)} buffer)`,
    };
  }

  // If speed is particularly low (< 50 KB/s)
  if (effectiveSpeed < 50 * 1024) {
    return {
      isMedia: true,
      canPlay: false,
      fileName: primary.name,
      filePath: primary.fullPath,
      duration,
      progress: progressRatio,
      bufferNeeded,
      secondsUntilSafe,
      timeToPlay: timeFormatted,
      reason: `Speed low (${formatBytes(effectiveSpeed)}/s) · Estimated time to play: ~${timeFormatted} (need ${formatBytes(bufferNeeded)} buffer)`,
    };
  }

  return {
    isMedia: true,
    canPlay: false,
    fileName: primary.name,
    filePath: primary.fullPath,
    duration,
    progress: progressRatio,
    bufferNeeded,
    secondsUntilSafe,
    timeToPlay: timeFormatted,
    reason: `Estimated time to play: ~${timeFormatted} (need ${formatBytes(bufferNeeded)} more buffer to stream smoothly)`,
  };
}

/**
 * Assess buffer-free playability for a folder scanner item.
 */
export function assessFolderItemPlayability(item) {
  const primary = findPrimaryVideoInFolder(item);
  if (!primary) {
    return {
      isMedia: false,
      canPlay: false,
      reason: 'No playable video file',
    };
  }

  const isRecoverable = item.status === 'recoverable';
  if (!isRecoverable) {
    return {
      isMedia: true,
      canPlay: true,
      fileName: primary.name,
      filePath: primary.fullPath,
      progress: 1,
      reason: 'Play in VLC',
    };
  }

  // Incomplete / halfway file
  return {
    isMedia: true,
    canPlay: false,
    fileName: primary.name,
    filePath: primary.fullPath,
    progress: (primary.downloaded || 0) / (primary.length || 1),
    reason: 'Incomplete file (resume download to estimate time to play)',
  };
}

/**
 * Launch VLC or the host operating system's default media player.
 */
export function launchMediaPlayer(filePath, cb) {
  let settled = false;
  const callback = cb;
  cb = (...args) => {
    if (settled) return;
    settled = true;
    callback(...args);
  };
  if (!filePath || !fs.existsSync(filePath)) {
    return cb(new Error('Media file not found on disk'));
  }

  if (process.platform === 'darwin') {
    const hasVlc = fs.existsSync('/Applications/VLC.app') || fs.existsSync('/opt/homebrew/bin/vlc');
    const args = hasVlc ? ['-a', 'VLC', filePath] : [filePath];
    const child = spawn('open', args);
    child.on('error', cb);
    child.on('close', (code) => {
      if (code !== 0) return cb(new Error(`Player exited with code ${code}`));
      cb(null, hasVlc ? 'VLC' : 'Default Player');
    });
    return;
  }

  if (process.platform === 'win32') {
    const child = spawn('cmd', ['/c', 'start', '""', filePath]);
    child.on('error', cb);
    child.on('close', (code) => cb(code === 0 ? null : new Error(`Player exited with code ${code}`), 'Default Player'));
    return;
  }

  // Linux
  const child = spawn('xdg-open', [filePath]);
  child.on('error', cb);
  child.on('close', (code) => cb(code === 0 ? null : new Error(`Player exited with code ${code}`), 'Default Player'));
}
