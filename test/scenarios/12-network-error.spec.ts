import { test, expect } from '../fixtures.js';

test.fail('navigation to unreachable server — network connection refused', async ({ page, forensics }) => {
  await page.goto('about:blank');
  await forensics.snapshot();

  await page.goto('http://localhost:1/nonexistent-page', { timeout: 5000 });
  await forensics.snapshot();
});
