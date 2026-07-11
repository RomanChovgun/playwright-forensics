import { test, expect } from '../fixtures.js';

test.fail('fill() on a non-input element (div) — Element is not an <input>', async ({ page, forensics }) => {
  await page.goto('page14-not-editable.html');
  await forensics.snapshot();

  await page.getByTestId('name-display').fill('Jane Doe');
});
