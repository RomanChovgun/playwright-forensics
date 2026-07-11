import { test, expect } from '../fixtures.js';

test.fail('mutation logging captures re-render changes', async ({ page, forensics }) => {
  await page.goto('page1-form-render.html');
  await forensics.startMutationLog();
  await forensics.snapshot();

  await page.fill('#name', 'Mutation Test');
  await forensics.snapshot();

  await page.click('#submit-btn');
  await forensics.snapshot();

  await expect(page.getByTestId('submit-btn')).toBeVisible();
});
