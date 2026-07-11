import { test, expect } from '../fixtures.js';

test.fail('attempting to interact with element before API finishes loading', async ({ page, forensics }) => {
  await page.goto('page4-slow-api.html');
  await forensics.snapshot();

  await page.getByTestId('load-data-btn').click();
  await page.waitForTimeout(500);
  await forensics.snapshot();

  await expect(page.getByTestId('report-101')).toBeVisible({ timeout: 2000 });
});
