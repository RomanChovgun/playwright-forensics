import { test, expect } from '../fixtures.js';

test.fail('selector breaks due to data-testid change on re-render', async ({ page, forensics }) => {
  await page.goto('page1-form-render.html');
  await forensics.snapshot();

  await page.fill('#name', 'Test User');
  await forensics.snapshot();

  await page.click('#submit-btn');
  await forensics.snapshot();

  await page.waitForTimeout(100);
  await forensics.snapshot();

  await expect(page.getByTestId('submit-btn')).toBeVisible();
});
