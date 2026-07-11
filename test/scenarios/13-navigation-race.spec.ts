import { test, expect } from '../fixtures.js';

test.fail('element from previous page is unavailable after navigation', async ({ page, forensics }) => {
  await page.goto('page13-navigation-race.html');
  await forensics.snapshot();

  const pageInfo = page.getByTestId('nav-link');
  await expect(pageInfo).toBeVisible();
  await forensics.snapshot();

  await pageInfo.click();
  await forensics.snapshot();

  await page.getByTestId('nav-link').click({ timeout: 3000 });
});
