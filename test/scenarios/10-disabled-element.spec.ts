import { test, expect } from '../fixtures.js';

test.fail('clicking a disabled button — element is not enabled', async ({ page, forensics }) => {
  await page.goto('page10-disabled-button.html');
  await forensics.snapshot();

  await page.getByTestId('submit-btn').click({ timeout: 3000 });
});
