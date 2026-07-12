import { test } from '../fixtures.js';

test('closed page with active mutation observer still produces a report', async ({ page, forensics }) => {
  test.fail();
  await page.setContent('<button data-testid="close-target">Close target</button>');
  await forensics.startMutationLog();
  await forensics.snapshot();
  await page.close();
  await page.getByTestId('close-target').click();
});
