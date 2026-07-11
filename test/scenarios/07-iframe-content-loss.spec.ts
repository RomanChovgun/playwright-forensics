import { test, expect } from '../fixtures.js';

test.fail('element inside iframe disappears after iframe reload', async ({ page, forensics }) => {
  await page.goto('page7-iframe-content.html');
  await forensics.snapshot();

  const iframe = page.frameLocator('[data-testid="main-iframe"]');
  await expect(iframe.getByTestId('iframe-description')).toBeVisible();
  await forensics.snapshot();

  await page.getByTestId('reload-iframe-btn').click();
  await page.waitForTimeout(200);
  await forensics.snapshot();

  await expect(iframe.getByTestId('iframe-item-2')).toBeVisible();
});
