import { test, expect } from '../fixtures.js';

test.fail('modal overlay blocks the target button', async ({ page, forensics }) => {
  await page.goto('page5-modal-overlay.html');
  await forensics.snapshot();

  await page.getByTestId('show-modal').click();
  await page.waitForTimeout(200);
  await forensics.snapshot();

  await page.getByTestId('delete-account-btn').click({ timeout: 3000 });
});
