import { test, expect } from '../fixtures.js';

test.fail('strict mode violation — locator matches multiple elements', async ({ page, forensics }) => {
  await page.goto('page9-strict-mode.html');
  await forensics.snapshot();

  await page.getByTestId('remove-btn').click({ timeout: 3000 });
});
