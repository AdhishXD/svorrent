import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const fixtureScript = fileURLToPath(new URL('../../backend/scripts/e2e-fixture.js', import.meta.url));

async function startFixture() {
  const child = spawn(process.execPath, ['--openssl-legacy-provider', fixtureScript], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  let errors = '';
  child.stderr.on('data', (chunk) => { errors += chunk; });
  const fixture = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Seeder did not start: ${errors}`)), 20000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('\n')) {
        clearTimeout(timer);
        try { resolve(JSON.parse(output.split('\n')[0])); }
        catch (error) { reject(error); }
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Seeder exited with code ${code}: ${errors}`));
    });
  });
  return { child, fixture };
}

test('a local torrent downloads through the UI, verifies, and deletes from disk', async ({ page }) => {
  test.setTimeout(90000);
  const { child, fixture } = await startFixture();
  let hash;
  let received;

  try {
    hash = fixture.infoHash;
    const config = await (await page.request.get('/api/config')).json();
    expect(config.downloadDir).toContain('svorrent-browser-test-');
    received = path.join(config.downloadDir, path.basename(fixture.source));

    await page.goto('/downloads');
    await page.getByRole('button', { name: 'Resume with magnet' }).click();
    await page.getByRole('dialog', { name: 'Resume a download' })
      .getByRole('textbox', { name: 'Magnet link or info hash' }).fill(fixture.magnet);
    await page.getByRole('dialog', { name: 'Resume a download' })
      .getByRole('button', { name: 'Resume download' }).click();

    await expect.poll(async () => {
      const items = await (await page.request.get('/api/torrents')).json();
      return items.find((item) => item.infoHash === hash)?.done || false;
    }, { timeout: 60000 }).toBe(true);
    expect(fs.existsSync(received)).toBe(true);
    const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    expect(digest(received)).toBe(digest(fixture.source));

    await page.locator('#filter-completed').click();
    const row = page.locator('.dl-row', { hasText: path.basename(fixture.source) });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Remove' }).click();
    const dialog = page.getByRole('dialog', { name: 'Remove download?' });
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Delete files' }).click();
    await expect.poll(() => fs.existsSync(received), { timeout: 15000 }).toBe(false);
  } finally {
    if (hash) {
      await page.request.post(`/api/torrent/${hash}/delete`, { data: { deleteFiles: true } }).catch(() => {});
    }
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.stdin.write('stop\n');
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
    if (child.exitCode === null) child.kill();
  }
});
