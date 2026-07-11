import { test, expect } from '../fixtures.js';

test.fail('element removed from DOM after list refresh', async ({ page, forensics }) => {
  await page.goto('page2-dynamic-list.html');
  await forensics.snapshot();

  const item1 = page.getByText('Task 1: Buy milk');
  await expect(item1).toBeVisible();
  await forensics.snapshot();

  await page.click('#refresh-btn');
  await page.waitForTimeout(200);
  await forensics.snapshot();

  await item1.click({ timeout: 3000 });
});
