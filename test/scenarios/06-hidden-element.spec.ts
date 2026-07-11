import { test, expect } from '../fixtures.js';

test.fail('attempting to interact with a hidden element (display: none)', async ({ page, forensics }) => {
  await page.goto('page6-hidden-element.html');
  await forensics.snapshot();

  await page.getByTestId('display-target').click({ timeout: 3000 });
});
