import assert from 'node:assert/strict';
import test from 'node:test';
import { progressPercent } from '../src/lib.js';

test('file progress stays in the valid 0–100% range', () => {
  assert.equal(progressPercent(-0.08), 0);
  assert.equal(progressPercent(0), 0);
  assert.equal(progressPercent(0.134), 13);
  assert.equal(progressPercent(1), 100);
  assert.equal(progressPercent(1.2), 100);
  assert.equal(progressPercent(NaN), 0);
});
