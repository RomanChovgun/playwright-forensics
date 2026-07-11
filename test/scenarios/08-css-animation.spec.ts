import { test, expect } from '../fixtures.js';

test.fail('clicking an infinitely animated element (CSS @keyframes — never stable)', async ({ page, forensics }) => {
  await page.goto('page8-css-animation.html');
  await forensics.snapshot();

  await page.getByTestId('animated-slide').click({ timeout: 3000 });
});
