import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { analyzeTraceFile } from '../../src/trace/analyze-trace.js';
import { readPlaywrightTrace } from '../../src/trace/trace-reader.js';
import { DEFAULT_CONFIG } from '../../src/config.js';

test('analyzes a real Playwright trace without forensics snapshots', async ({ browser }, testInfo) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const tracePath = testInfo.outputPath('trace.zip');
  await context.tracing.start({ snapshots: true, screenshots: true, sources: true });
  await page.setContent('<main><button data-testid="present">Present</button></main>');
  await page.getByTestId('present').click();
  await page.getByTestId('missing').click({ timeout: 100 }).catch(() => undefined);
  await context.tracing.stop({ path: tracePath });
  await context.close();

  const evidence = await readPlaywrightTrace(tracePath, {
    maxEvents: DEFAULT_CONFIG.trace.maxEvents,
    redact: value => value,
  });
  expect(evidence.actions.some(action => action.error)).toBe(true);
  expect(evidence.frameSnapshots.length).toBeGreaterThan(0);

  const outputDir = testInfo.outputPath('standalone-report');
  const result = await analyzeTraceFile(tracePath, { outputDir });
  const report = JSON.parse(await readFile(result.paths.json, 'utf8'));
  expect(report.verdict.confidence).toMatch(/confirmed|likely|insufficient-evidence/);
  expect(report.failedAction).toBeDefined();
  expect(report.snapshots.length).toBeGreaterThan(0);
  expect(report.trace.frameSnapshots).toBeUndefined();
});
