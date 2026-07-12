import { defineConfig } from '@playwright/test';
import path from 'path';
import { existsSync } from 'fs';
import { pathToFileURL } from 'url';

const testPagesDir = path.resolve(process.cwd(), 'test-pages');
const baseURL = pathToFileURL(testPagesDir + '/').href;

const reporters: NonNullable<Parameters<typeof defineConfig>[0]['reporter']> = [
  ['list'],
  ['./test/golden-reporter.ts'],
];

// Only attach forensics reporter if dist is built
const forensicsReporterPath = './dist/reporter/reporter.js';
if (existsSync(path.resolve(forensicsReporterPath))) {
  reporters.push([forensicsReporterPath]);
} else {
  console.warn('⚠️  Forensics reporter not found — run `npm run build` first to enable forensics reports');
}

export default defineConfig({
  testDir: './test/scenarios',
  timeout: 60_000,
  retries: 0,
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
    baseURL,
  },
  reporter: reporters,
});
