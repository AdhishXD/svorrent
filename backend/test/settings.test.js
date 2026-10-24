import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSettingsManager } from '../lib/settings.js';

test('settings manager defaults to autoStopSeeding: false and persists updates', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svorrent-settings-test-'));
  try {
    const manager = createSettingsManager(tmpDir);
    assert.equal(manager.get().autoStopSeeding, false);

    const updated = manager.update({ autoStopSeeding: true });
    assert.equal(updated.autoStopSeeding, true);
    assert.equal(manager.get().autoStopSeeding, true);

    // Verify on-disk persistence by creating a second manager instance
    const secondManager = createSettingsManager(tmpDir);
    assert.equal(secondManager.get().autoStopSeeding, true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
