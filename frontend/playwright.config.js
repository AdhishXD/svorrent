import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3001',
    trace: 'off',
    headless: true,
  },
  webServer: {
    command: 'node --openssl-legacy-provider server.js',
    cwd: '../backend',
    url: 'http://127.0.0.1:3001/api/config',
    reuseExistingServer: true,
    timeout: 20000,
  },
});
