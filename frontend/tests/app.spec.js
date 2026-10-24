import { test, expect } from '@playwright/test';

test.describe('Svorrent Web End-to-End Application Checks', () => {
  test('App loads cleanly and navigates through tabs without any console or runtime errors', async ({ page }) => {
    const runtimeErrors = [];
    
    // Catch unhandled page exceptions
    page.on('pageerror', (err) => {
      runtimeErrors.push(`[PageError] ${err.message}`);
    });

    // Catch severe console errors
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        runtimeErrors.push(`[ConsoleError] ${msg.text()}`);
      }
    });

    // 1. Visit root URL
    await page.goto('/');
    await expect(page).toHaveTitle(/Svorrent/);

    // 2. Verify header brand and primary navigation exist
    await expect(page.locator('.brand-logo')).toBeVisible();
    await expect(page.locator('#nav-search')).toBeVisible();
    await expect(page.locator('#nav-downloads')).toBeVisible();
    await expect(page.locator('#nav-networks')).toBeVisible();

    // 3. Switch to Downloads tab
    await page.click('#nav-downloads');
    await expect(page).toHaveURL(/.*downloads/);
    await expect(page).toHaveTitle(/Downloads · Svorrent/);

    // 4. Switch to Networks tab
    await page.click('#nav-networks');
    await expect(page).toHaveURL(/.*networks/);
    await expect(page).toHaveTitle(/Networks · Svorrent/);
    await expect(page.locator('.networks-container')).toBeVisible();

    // 5. Switch back to Search tab
    await page.click('#nav-search');
    await expect(page).toHaveURL(/\//);
    await expect(page).toHaveTitle('Svorrent');

    // 6. Assert zero runtime errors or unhandled exceptions occurred
    expect(runtimeErrors).toEqual([]);
  });
});
