import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSemver, isNewerVersion, AutoUpdater } from '../lib/updater.js';

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
