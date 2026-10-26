import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSemver, isNewerVersion, AutoUpdater } from '../lib/updater.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('parseSemver parses clean and prefixed versions correctly', () => {
  assert.deepEqual(parseSemver('1.0.1'), [1, 0, 1]);
  assert.deepEqual(parseSemver('v1.2.3'), [1, 2, 3]);
  assert.deepEqual(parseSemver('V2.0'), [2, 0, 0]);
  assert.deepEqual(parseSemver(''), [0, 0, 0]);
  assert.deepEqual(parseSemver(null), [0, 0, 0]);
});

test('isNewerVersion detects major, minor, and patch upgrades correctly', () => {
  assert.equal(isNewerVersion('1.0.1', '1.0.2'), true);
  assert.equal(isNewerVersion('1.0.1', 'v1.1.0'), true);
  assert.equal(isNewerVersion('1.0.1', '2.0.0'), true);
  assert.equal(isNewerVersion('1.0.1', '1.0.1'), false);
  assert.equal(isNewerVersion('1.0.2', '1.0.1'), false);
  assert.equal(isNewerVersion('2.0.0', '1.9.9'), false);
});

test('AutoUpdater initializes in idle state with correct version metadata', () => {
  const updater = new AutoUpdater({ currentVersion: '1.0.1' });
  const status = updater.getStatus();
  assert.equal(status.currentVersion, '1.0.1');
  assert.equal(status.status, 'idle');
  assert.equal(status.readyToInstall, false);
});

test('macOS updater selects only the signed build matching upstream main', async () => {
  const installed = 'a'.repeat(40);
  const latest = 'b'.repeat(40);
  const asset = {
    name: `Svorrent-${latest}.dmg`,
    digest: `sha256:${'c'.repeat(64)}`,
    browser_download_url: 'https://github.com/sovopr/svorrent/releases/download/main-snapshot/build.dmg',
  };
  const updater = new AutoUpdater({ platform: 'darwin', currentCommit: installed });
  const originalFetch = globalThis.fetch;
  let selected = null;
  updater.downloadUpdate = async (item) => { selected = item; };
  globalThis.fetch = async (url) => Response.json(url.endsWith('/commits/main')
    ? { sha: latest }
    : { assets: [{ ...asset, name: `Svorrent-${installed}.dmg` }, asset] });
  try {
    const status = await updater.checkForUpdates();
    assert.equal(status.channel, 'main');
    assert.equal(status.latestCommit, latest);
    assert.equal(status.updateAvailable, true);
    assert.deepEqual(selected, asset);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Windows updater selects only the signed installer matching upstream main', async () => {
  const installed = 'a'.repeat(40);
  const latest = 'b'.repeat(40);
  const asset = {
    name: `Svorrent-${latest}-Setup.exe`,
    digest: `sha256:${'c'.repeat(64)}`,
    browser_download_url: 'https://github.com/sovopr/svorrent/releases/download/main-windows-snapshot/build.exe',
  };
  const updater = new AutoUpdater({ platform: 'win32', currentCommit: installed });
  const originalFetch = globalThis.fetch;
  let selected = null;
  const requested = [];
  updater.downloadUpdate = async (item) => { selected = item; };
  globalThis.fetch = async (url) => {
    requested.push(url);
    return Response.json(url.endsWith('/commits/main')
      ? { sha: latest }
      : { assets: [{ ...asset, name: 'Svorrent-Setup.exe' }, asset] });
  };
  try {
    const status = await updater.checkForUpdates();
    assert.equal(status.channel, 'main');
    assert.equal(status.latestCommit, latest);
    assert.equal(status.updateAvailable, true);
    assert.deepEqual(selected, asset);
    assert.ok(requested.some((url) => url.endsWith('/releases/tags/main-windows-snapshot')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Windows updater waits for a matching signed installer', async () => {
  const latest = 'b'.repeat(40);
  const updater = new AutoUpdater({ platform: 'win32', currentCommit: 'a'.repeat(40) });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => Response.json(url.endsWith('/commits/main')
    ? { sha: latest } : { assets: [] });
  try {
    const status = await updater.checkForUpdates();
    assert.equal(status.status, 'building');
    assert.equal(status.updateAvailable, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('macOS updater waits for a matching build and reports GitHub failures', async () => {
  const latest = 'b'.repeat(40);
  const updater = new AutoUpdater({ platform: 'darwin', currentCommit: 'a'.repeat(40) });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => Response.json(url.endsWith('/commits/main')
    ? { sha: latest } : { assets: [] });
  try {
    const building = await updater.checkForUpdates();
    assert.equal(building.status, 'building');
    assert.equal(building.updateAvailable, false);
    globalThis.fetch = async (url) => url.endsWith('/commits/main')
      ? Response.json({ sha: latest }) : Response.json({}, { status: 404 });
    const unavailable = await updater.checkForUpdates();
    assert.equal(unavailable.status, 'unavailable');
    assert.equal(unavailable.updateAvailable, false);
    globalThis.fetch = async () => Response.json({}, { status: 503 });
    const failed = await updater.checkForUpdates();
    assert.equal(failed.status, 'error');
    assert.equal(failed.updateAvailable, false);
    assert.match(failed.error, /503/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('macOS updater rejects a downloaded build with the wrong digest', async () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svorrent-updater-test-'));
  const updater = new AutoUpdater({ platform: 'darwin', cacheDir });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('not a valid DMG');
  try {
    await assert.rejects(updater.downloadUpdate({
      name: 'Svorrent-test.dmg',
      digest: `sha256:${'0'.repeat(64)}`,
      browser_download_url: 'https://example.invalid/build.dmg',
    }), /SHA-256 verification/);
    assert.equal(fs.existsSync(path.join(cacheDir, 'Svorrent-test.dmg')), false);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});
