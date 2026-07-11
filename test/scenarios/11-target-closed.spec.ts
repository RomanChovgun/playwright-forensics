import { test, expect } from '../fixtures.js';

test.fail('target closed — interacting with page after it is closed', async ({ page, forensics }) => {
  await page.goto('page3-spa-router.html');
  await forensics.snapshot();

  await page.close();
  await page.getByTestId('home-btn').click({ timeout: 3000 });
});
