import { test, expect } from '../fixtures.js';

test('passing test does not generate forensics report', async ({ page, forensics }) => {
  await page.goto('page1-form-render.html');
  await forensics.snapshot();
  await forensics.snapshot();

  expect(forensics.history.length).toBe(3); // 1 initial + 2 manual
  expect(forensics.mutationLogs.length).toBe(0);

  // Verify the page is actually rendered
  const title = await page.title();
  expect(title).toBeTruthy();
});
