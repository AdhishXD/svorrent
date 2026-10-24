import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { childPath, hasSafeParent } from '../lib/safe-path.js';

test('torrent file paths remain inside their download root', () => {
  const root = path.resolve('/tmp/svorrent-safe-path-test');
  assert.equal(childPath(root, 'Film/video.mkv'), path.join(root, 'Film', 'video.mkv'));
  for (const value of ['', '.', '..', '../other', 'Film/../../other', '/etc/passwd', 'bad\0name']) {
    assert.equal(childPath(root, value), null, value);
  }
});

test('rejects a parent symlink that points outside the download root', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'svorrent-path-test-'));
  try {
    try {
      fs.symlinkSync(os.tmpdir(), path.join(root, 'outside'));
    } catch (err) {
      if ((err.code === 'EPERM' || err.code === 'EEXIST') && process.platform === 'win32') {
        t.skip('Symlinks require elevated developer privileges on Windows');
        return;
      }
      throw err;
    }
    assert.equal(hasSafeParent(root, path.join(root, 'outside', 'file.mkv')), false);
    assert.equal(hasSafeParent(root, path.join(root, 'file.mkv')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

