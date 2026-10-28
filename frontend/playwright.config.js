import { defineConfig } from '@playwright/test';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const testRoot = process.env.SVORRENT_PLAYWRIGHT_TEST_ROOT || path.join(os.tmpdir(), `svorrent-browser-test-${process.pid}`);
process.env.SVORRENT_PLAYWRIGHT_TEST_ROOT = testRoot;
const freePort = async () => {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
};
const port = Number(process.env.SVORRENT_PLAYWRIGHT_PORT) || await freePort();
const torrentPort = Number(process.env.SVORRENT_PLAYWRIGHT_TORRENT_PORT) || await freePort();
process.env.SVORRENT_PLAYWRIGHT_PORT = String(port);
process.env.SVORRENT_PLAYWRIGHT_TORRENT_PORT = String(torrentPort);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests',
  globalTeardown: './tests/cleanup.js',
  timeout: 30000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  use: {
    baseURL,
    trace: 'off',
    headless: true,
  },
  webServer: {
    command: 'node --openssl-legacy-provider server.js',
    cwd: '../backend',
    url: `${baseURL}/api/config`,
    reuseExistingServer: false,
    env: {
      PORT: String(port),
      TORRENT_PORT: String(torrentPort),
      SVORRENT_DOWNLOAD_DIR: path.join(testRoot, 'downloads'),
      SVORRENT_DATA_DIR: path.join(testRoot, 'data'),
      SVORRENT_DISABLE_PUBLIC_DISCOVERY: '1',
    },
    timeout: 20000,
  },
});
