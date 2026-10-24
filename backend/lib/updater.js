// Svorrent Background Silent Auto-Updater
// Silently checks for GitHub Releases, downloads updates in background,
// and applies updates seamlessly on restart.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

export function parseSemver(versionStr) {
  if (typeof versionStr !== 'string') return [0, 0, 0];
  const clean = versionStr.replace(/^v/i, '').trim();
  const parts = clean.split('.').map((p) => {
    const num = parseInt(p, 10);
    return Number.isFinite(num) ? num : 0;
  });
  while (parts.length < 3) parts.push(0);
  return parts.slice(0, 3);
}

export function isNewerVersion(currentVer, latestVer) {
  const [cMaj, cMin, cPat] = parseSemver(currentVer);
  const [lMaj, lMin, lPat] = parseSemver(latestVer);

  if (lMaj > cMaj) return true;
  if (lMaj < cMaj) return false;
  if (lMin > cMin) return true;
  if (lMin < cMin) return false;
  return lPat > cPat;
}

export class AutoUpdater {
  constructor(options = {}) {
    this.currentVersion = options.currentVersion || '1.0.1';
    this.repo = options.repo || 'sovopr/svorrent';
    this.checkIntervalMs = options.checkIntervalMs || 6 * 60 * 60 * 1000; // 6 hours
    this.cacheDir = options.cacheDir || this.resolveCacheDir();
    this.state = {
      status: 'idle', // 'idle' | 'checking' | 'available' | 'downloading' | 'ready_to_install' | 'error'
      latestVersion: null,
      releaseNotes: '',
      releaseUrl: null,
      assetName: null,
      assetPath: null,
      downloadProgress: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      lastChecked: null,
      error: null,
    };
    this.checkTimer = null;
    this.abortController = null;
  }

  resolveCacheDir() {
    if (process.platform === 'darwin') {
      return path.join(os.homedir(), 'Library', 'Caches', 'Svorrent', 'updates');
    }
    if (process.platform === 'win32') {
      const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      return path.join(base, 'Svorrent', 'updates');
    }
    return path.join(os.homedir(), '.cache', 'svorrent', 'updates');
  }

  start() {
    fs.mkdirSync(this.cacheDir, { recursive: true });
    // Run an initial check 5 seconds after startup
    setTimeout(() => {
      this.checkForUpdates().catch(() => {});
    }, 5000);

    // Setup periodic check
    this.checkTimer = setInterval(() => {
      this.checkForUpdates().catch(() => {});
    }, this.checkIntervalMs);
  }

  stop() {
    if (this.checkTimer) clearInterval(this.checkTimer);
    if (this.abortController) this.abortController.abort();
  }

  getStatus() {
    return {
      currentVersion: this.currentVersion,
      ...this.state,
      readyToInstall: this.state.status === 'ready_to_install',
    };
  }

  async checkForUpdates() {
    if (this.state.status === 'downloading' || this.state.status === 'ready_to_install') {
      return this.getStatus();
    }

    this.state.status = 'checking';
    this.state.error = null;
    this.state.lastChecked = new Date().toISOString();

    try {
      const res = await fetch(`https://api.github.com/repos/${this.repo}/releases/latest`, {
        headers: {
          'User-Agent': `Svorrent/${this.currentVersion}`,
          'Accept': 'application/vnd.github.v3+json',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        throw new Error(`GitHub Releases API responded with status ${res.status}`);
      }

      const release = await res.json();
      const tagName = release.tag_name || release.name || '';
      const isNewer = isNewerVersion(this.currentVersion, tagName);

      if (!isNewer) {
        this.state.status = 'idle';
        this.state.latestVersion = tagName;
        return this.getStatus();
      }

      this.state.status = 'available';
      this.state.latestVersion = tagName;
      this.state.releaseNotes = release.body || '';
      this.state.releaseUrl = release.html_url || '';

      // Find appropriate asset for current OS
      const assets = release.assets || [];
      let targetAsset = null;

      if (process.platform === 'darwin') {
        targetAsset = assets.find((a) => a.name.endsWith('.dmg')) ||
                      assets.find((a) => a.name.endsWith('.zip'));
      } else if (process.platform === 'win32') {
        targetAsset = assets.find((a) => a.name.endsWith('Setup.exe')) ||
                      assets.find((a) => a.name.endsWith('.exe'));
      }

      if (targetAsset && targetAsset.browser_download_url) {
        // Silently start downloading in background
        this.downloadUpdate(targetAsset).catch((err) => {
          console.error('[Updater] Background download failed:', err.message);
        });
      }

      return this.getStatus();
    } catch (err) {
      this.state.status = 'error';
      this.state.error = err.message;
      return this.getStatus();
    }
  }

  async downloadUpdate(asset) {
    this.state.status = 'downloading';
    this.state.assetName = asset.name;
    this.state.totalBytes = asset.size || 0;
    this.state.downloadedBytes = 0;
    this.state.downloadProgress = 0;

    const targetFile = path.join(this.cacheDir, asset.name);
    const tempFile = `${targetFile}.download`;

    this.abortController = new AbortController();

    try {
      const response = await fetch(asset.browser_download_url, {
        headers: {
          'User-Agent': `Svorrent/${this.currentVersion}`,
        },
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Download failed with status ${response.status}`);
      }

      const total = Number(response.headers.get('content-length')) || asset.size || 0;
      this.state.totalBytes = total;

      const fileStream = fs.createWriteStream(tempFile);
      const reader = response.body.getReader();

      const progressStream = new Readable({
        async read() {
          try {
            const { done, value } = await reader.read();
            if (done) {
              this.push(null);
            } else {
              this.push(Buffer.from(value));
            }
          } catch (e) {
            this.destroy(e);
          }
        },
      });

      progressStream.on('data', (chunk) => {
        this.state.downloadedBytes += chunk.length;
        if (this.state.totalBytes > 0) {
          this.state.downloadProgress = Math.min(
            100,
            Math.round((this.state.downloadedBytes / this.state.totalBytes) * 100)
          );
        }
      });

      await pipeline(progressStream, fileStream);

      // Download complete: atomically move temp to target
      if (fs.existsSync(targetFile)) {
        fs.unlinkSync(targetFile);
      }
      fs.renameSync(tempFile, targetFile);

      this.state.assetPath = targetFile;
      this.state.status = 'ready_to_install';
      this.state.downloadProgress = 100;
      console.log(`[Updater] Update downloaded and ready to install: ${targetFile}`);
    } catch (err) {
      if (fs.existsSync(tempFile)) {
        try { fs.unlinkSync(tempFile); } catch {}
      }
      this.state.status = 'error';
      this.state.error = err.message;
      throw err;
    } finally {
      this.abortController = null;
    }
  }

  async applyUpdate() {
    if (this.state.status !== 'ready_to_install' || !this.state.assetPath || !fs.existsSync(this.state.assetPath)) {
      throw new Error('No update is downloaded or ready to install');
    }

    const assetPath = this.state.assetPath;
    console.log(`[Updater] Applying update from ${assetPath}...`);

    if (process.platform === 'win32') {
      // Windows NSIS silent update execution
      // Launches Svorrent-Setup.exe /S in background and exits current process
      const child = spawn(assetPath, ['/S'], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();

      setTimeout(() => {
        process.exit(0);
      }, 1000);
      return { success: true, message: 'Restarting Windows installer...' };
    }

    if (process.platform === 'darwin') {
      // macOS DMG silent in-place app replacement
      const mountPoint = path.join(os.tmpdir(), 'svorrent_update_mount');
      try {
        fs.mkdirSync(mountPoint, { recursive: true });
        spawn('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mountPoint, assetPath], {
          stdio: 'ignore',
        });
      } catch {}

      // Fallback: open the DMG so user has frictionless update or run installer script
      const installerScript = `
        sleep 1
        hdiutil attach -nobrowse -readonly "${assetPath}" -mountpoint "${mountPoint}" 2>/dev/null || true
        if [ -d "${mountPoint}/Svorrent.app" ]; then
          rm -rf "/Applications/Svorrent.app"
          cp -R "${mountPoint}/Svorrent.app" "/Applications/"
          hdiutil detach "${mountPoint}" 2>/dev/null || true
          open "/Applications/Svorrent.app"
        else
          open "${assetPath}"
        fi
      `;

      const helper = spawn('/bin/bash', ['-c', installerScript], {
        detached: true,
        stdio: 'ignore',
      });
      helper.unref();

      setTimeout(() => {
        process.exit(0);
      }, 1000);
      return { success: true, message: 'Applying update and restarting Svorrent...' };
    }

    return { success: false, message: 'Automatic in-place restart not supported on this platform' };
  }
}
