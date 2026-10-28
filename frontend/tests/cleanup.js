import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export default async function cleanup() {
  const root = process.env.SVORRENT_PLAYWRIGHT_TEST_ROOT;
  if (!root || path.dirname(root) !== os.tmpdir() || !/^svorrent-browser-test-\d+$/.test(path.basename(root))) {
    throw new Error('Refusing to clean an unexpected browser-test directory');
  }
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
}
