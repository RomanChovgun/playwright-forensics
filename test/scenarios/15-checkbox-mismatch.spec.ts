import { test, expect } from '../fixtures.js';

test.fail('check() on a button — Element is not a checkbox or radio button', async ({ page, forensics }) => {
  await page.goto('page15-checkbox-mismatch.html');
  await forensics.snapshot();

  await page.getByTestId('save-btn').check({ timeout: 3000 });
});
