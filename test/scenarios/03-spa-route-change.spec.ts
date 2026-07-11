import { test, expect } from '../fixtures.js';

test.fail('element from previous SPA route is unavailable after navigation', async ({ page, forensics }) => {
  await page.goto('page3-spa-router.html');
  await forensics.snapshot();

  const homeBtn = page.getByTestId('home-action-btn');
  await expect(homeBtn).toBeVisible();
  await forensics.snapshot();

  await page.getByTestId('nav-profile').click();
  await page.waitForTimeout(100);
  await forensics.snapshot();

  await homeBtn.click({ timeout: 3000 });
});
