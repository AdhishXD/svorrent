import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';

// Common playable video container extensions
export const VIDEO_EXTENSIONS = new Set([
  '.mkv', '.mp4', '.avi', '.mov', '.m4v', '.webm', '.ts', '.flv', '.wmv', '.vob', '.ogv', '.m2ts'
]);

// Cache for probed video metadata: filePath -> { duration: seconds, bitrate: bits/s, probedAt: timestamp }
const metaCache = new Map();
const inFlightProbes = new Set();

/**
 * Locate ffprobe binary on the host system.
 */
export function findFfprobe() {
  const candidates = [
    'ffprobe',
    '/Users/soveet/miniforge3/bin/ffprobe',
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

/**
 * Format duration/eta in seconds into human readable format (e.g. 14m, 1h 22m).
 */
export function formatEta(seconds) {
  if (!seconds || seconds <= 0 || !isFinite(seconds)) return '0s';
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.ceil((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
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
 * Trigger asynchronous ffprobe extraction to determine real container runtime.
 */
export function probeMediaAsync(filePath) {
  if (!filePath || !fs.existsSync(filePath) || inFlightProbes.has(filePath)) return;
  if (metaCache.has(filePath)) return;

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
  const fullPath = path.join(basePath, largest.path || largest.name);

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
  if (item.type === 'file') {
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
  const cacheKey = `${item.absolutePath}:${item.mtime || item.sizeOnDisk || 0}`;
  const cached = folderPrimaryVideoCache.get(cacheKey);
  if (cached && (Date.now() - cached.cachedAt) < 10000) {
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
            } catch (e) {}
          }
        }
      }
    }
    scanDir(item.absolutePath);
    const result = candidates.length > 0
      ? candidates.reduce((a, b) => (a.length > b.length ? a : b))
      : null;

    folderPrimaryVideoCache.set(cacheKey, { result, cachedAt: Date.now() });
    return result;
  } catch (e) {
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
  const isDone = !!(torrent.done || (primary.length > 0 && primary.downloaded >= primary.length * 0.999));
  if (isDone) {
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
  // Matroska / MP4 container headers, audio tracks, and initial cluster must be present.
  const minHeaderBytes = Math.min(25 * 1024 * 1024, totalLength * 0.02);
  if (downloaded < minHeaderBytes) {
    const needed = minHeaderBytes - downloaded;
    return {
      isMedia: true,
      canPlay: false,
      fileName: primary.name,
      filePath: primary.fullPath,
      progress: progressRatio,
      reason: `Buffering headers… (need ${formatBytes(needed)} more)`,
    };
  }

  // Queue background ffprobe extraction if headers are present
  probeMediaAsync(primary.fullPath);

  // Requirement 2: Continuous buffer streaming equation
  const cachedMeta = metaCache.get(primary.fullPath);
  const duration = cachedMeta?.duration || estimateDuration(totalLength);
  const speed = torrent.downloadSpeed || 0;

  // If download is paused or stalled (< 50 KB/s)
  if (speed < 50 * 1024) {
    return {
      isMedia: true,
      canPlay: false,
      fileName: primary.name,
      filePath: primary.fullPath,
      duration,
      progress: progressRatio,
      reason: torrent.paused ? 'Download paused' : 'Speed too low to stream without buffering',
    };
  }

  const remainingBytes = Math.max(0, totalLength - downloaded);
  const etaSeconds = remainingBytes / speed;
  const safetyMargin = 1.20; // 20% safety margin against connection fluctuations

  // Physical Condition: Download ETA with 20% margin <= Total Video Runtime
  if (etaSeconds * safetyMargin <= duration) {
    return {
      isMedia: true,
      canPlay: true,
      fileName: primary.name,
      filePath: primary.fullPath,
      duration,
      progress: progressRatio,
      reason: 'Play in VLC (Safe to stream without buffering)',
    };
  }

  // Calculate buffer required to reach the safe streaming threshold
  const safeDownloadedTarget = Math.max(0, totalLength - (speed * duration) / safetyMargin);
  const bufferNeeded = Math.max(0, safeDownloadedTarget - downloaded);
  const secondsUntilSafe = Math.ceil(bufferNeeded / speed);

  return {
    isMedia: true,
    canPlay: false,
    fileName: primary.name,
    filePath: primary.fullPath,
    duration,
    progress: progressRatio,
    bufferNeeded,
    secondsUntilSafe,
    reason: `Buffering… Safe in ~${formatEta(secondsUntilSafe)} (need ${formatBytes(bufferNeeded)} more buffer)`,
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
    reason: 'Incomplete file (resume download to play)',
  };
}

/**
 * Launch VLC or the host operating system's default media player.
 */
export function launchMediaPlayer(filePath, cb) {
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
    child.on('close', () => cb(null, 'Default Player'));
    return;
  }

  // Linux
  const child = spawn('xdg-open', [filePath]);
  child.on('error', cb);
  child.on('close', () => cb(null, 'Default Player'));
}
