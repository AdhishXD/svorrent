// Svorrent updater: macOS follows signed builds of upstream main, while
// Windows continues to use versioned releases.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

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
    this.currentCommit = options.currentCommit || null;
    this.platform = options.platform || process.platform;
    this.repo = options.repo || 'sovopr/svorrent';
    this.checkIntervalMs = options.checkIntervalMs || 6 * 60 * 60 * 1000; // 6 hours
    this.cacheDir = options.cacheDir || this.resolveCacheDir();
    this.state = {
      status: 'idle', // 'idle' | 'checking' | 'building' | 'available' | 'downloading' | 'ready_to_install' | 'error'
      latestVersion: null,
      latestCommit: null,
      releaseNotes: '',
      releaseUrl: null,
      assetName: null,
      assetPath: null,
      assetDigest: null,
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
    if (this.platform === 'darwin') {
      return path.join(os.homedir(), 'Library', 'Caches', 'Svorrent', 'updates');
    }
    if (this.platform === 'win32') {
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
    const isNewer = this.platform === 'darwin'
      ? !!this.state.latestCommit && this.state.latestCommit !== this.currentCommit
      : this.state.latestVersion ? isNewerVersion(this.currentVersion, this.state.latestVersion) : false;
    const ready = this.state.status === 'ready_to_install' && isNewer;
    return {
      currentVersion: this.currentVersion,
      currentCommit: this.currentCommit,
      channel: this.platform === 'darwin' ? 'main' : 'release',
      ...this.state,
      updateAvailable: isNewer && !['building', 'error'].includes(this.state.status),
      readyToInstall: ready,
    };
  }

  async checkForUpdates() {
    const isNewer = this.getStatus().updateAvailable;
    if (this.state.status === 'ready_to_install' && !isNewer) {
      this.state.status = 'idle';
      this.state.assetPath = null;
    }
    if (this.state.status === 'downloading' || (this.state.status === 'ready_to_install' && isNewer)) {
      return this.getStatus();
    }

    this.state.status = 'checking';
    this.state.error = null;
    this.state.lastChecked = new Date().toISOString();

    try {
      if (this.platform === 'darwin') return await this.checkMainBuild();

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

      if (this.platform === 'darwin') {
        targetAsset = assets.find((a) => a.name.endsWith('.dmg')) ||
                      assets.find((a) => a.name.endsWith('.zip'));
      } else if (this.platform === 'win32') {
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

  async checkMainBuild() {
    const headers = {
      'User-Agent': `Svorrent/${this.currentVersion}`,
      'Accept': 'application/vnd.github+json',
    };
    const mainResponse = await fetch(`https://api.github.com/repos/${this.repo}/commits/main`, {
      headers, signal: AbortSignal.timeout(10000),
    });
    if (!mainResponse.ok) throw new Error(`GitHub main check failed (${mainResponse.status})`);
    const main = await mainResponse.json();
    if (!/^[0-9a-f]{40}$/.test(main.sha || '')) throw new Error('GitHub returned an invalid main commit');

    this.state.latestCommit = main.sha;
    this.state.latestVersion = this.currentVersion;
    if (main.sha === this.currentCommit) {
      this.state.status = 'idle';
      return this.getStatus();
    }

    const releaseResponse = await fetch(`https://api.github.com/repos/${this.repo}/releases/tags/main-snapshot`, {
      headers, signal: AbortSignal.timeout(10000),
    });
    if (!releaseResponse.ok) {
      if (releaseResponse.status === 404) {
        this.state.status = 'building';
        return this.getStatus();
      }
      throw new Error(`GitHub main build check failed (${releaseResponse.status})`);
    }
    const release = await releaseResponse.json();
    const asset = (release.assets || []).find((item) => item.name === `Svorrent-${main.sha}.dmg`);
    if (!asset) {
      this.state.status = 'building';
      return this.getStatus();
    }
    if (!/^sha256:[0-9a-f]{64}$/.test(asset.digest || '')) {
      throw new Error('The main build has no SHA-256 digest');
    }
    if (!asset.browser_download_url || !asset.name) throw new Error('The main build has no download URL');

    this.state.status = 'available';
    this.state.releaseUrl = release.html_url || '';
    this.state.releaseNotes = release.body || '';
    this.downloadUpdate(asset).catch((err) => {
      console.error('[Updater] Background download failed:', err.message);
    });
    return this.getStatus();
  }

  async downloadUpdate(asset) {
    this.state.status = 'downloading';
    this.state.assetName = asset.name;
    this.state.assetDigest = asset.digest || null;
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
      const hash = createHash('sha256');
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
        hash.update(chunk);
        this.state.downloadedBytes += chunk.length;
        if (this.state.totalBytes > 0) {
          this.state.downloadProgress = Math.min(
            100,
            Math.round((this.state.downloadedBytes / this.state.totalBytes) * 100)
          );
        }
      });

      await pipeline(progressStream, fileStream);
      if (this.state.assetDigest && `sha256:${hash.digest('hex')}` !== this.state.assetDigest) {
        throw new Error('Downloaded update failed SHA-256 verification');
      }

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

    if (this.platform === 'win32') {
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

    if (this.platform === 'darwin') {
      if (!/^sha256:[0-9a-f]{64}$/.test(this.state.assetDigest || '') ||
          !/^[0-9a-f]{40}$/.test(this.state.latestCommit || '')) {
        throw new Error('The main build is missing verification metadata');
      }
      const appPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../');
      if (!appPath.startsWith('/Applications/') || path.basename(appPath) !== 'Svorrent.app') {
        throw new Error('Automatic installation requires Svorrent in Applications');
      }
      const installer = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/apply-macos-update.sh');
      fs.accessSync(path.dirname(appPath), fs.constants.W_OK);
      fs.accessSync(installer, fs.constants.R_OK);
      const logDir = path.join(os.homedir(), 'Library', 'Logs', 'Svorrent');
      fs.mkdirSync(logDir, { recursive: true });
      const logFd = fs.openSync(path.join(logDir, 'update.log'), 'a');
      const helper = spawn('/bin/bash', [installer, assetPath, this.state.assetDigest, this.state.latestCommit, appPath], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
      });
      fs.closeSync(logFd);
      if (!helper.pid) throw new Error('Could not start the macOS update installer');
      helper.unref();

      setTimeout(() => {
        process.exit(0);
      }, 1000);
      return { success: true, message: 'Applying update and restarting Svorrent...' };
    }

    return { success: false, message: 'Automatic in-place restart not supported on this platform' };
  }
}
