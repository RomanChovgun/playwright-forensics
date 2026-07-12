import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';

const dir = await mkdtemp(join(tmpdir(), 'pwf-cli-'));
const tracePath = join(dir, 'trace.zip');
const outputDir = join(dir, 'report');
const events = [
  { type: 'context-options', version: 8 },
  {
    type: 'before',
    callId: 'call@1',
    class: 'Locator',
    method: 'click',
    params: { selector: 'internal:testid=[data-testid="missing"s]' },
    startTime: 1,
    beforeSnapshot: 'before@call@1',
  },
  {
    type: 'frame-snapshot',
    snapshot: {
      snapshotName: 'before@call@1',
      callId: 'call@1',
      pageId: 'page@1',
      frameId: 'frame@1',
      frameUrl: 'https://example.test/',
      timestamp: 1,
      collectionTime: 1,
      viewport: { width: 1280, height: 720 },
      resourceOverrides: [],
      isMainFrame: true,
      html: ['HTML', {}, ['BODY', {}, ['BUTTON', { 'data-testid': 'present' }, 'Present']]],
    },
  },
  {
    type: 'after',
    callId: 'call@1',
    endTime: 2,
    error: { message: 'TimeoutError: locator.click: Timeout 100ms exceeded.' },
  },
].map(event => JSON.stringify(event)).join('\n');
await writeFile(tracePath, zipSync({ '0-trace.trace': strToU8(events) }));

const result = spawnSync(process.execPath, [
  fileURLToPath(new URL('../dist/cli.js', import.meta.url)),
  'analyze',
  tracePath,
  '--output',
  outputDir,
], { encoding: 'utf8' });

if (result.status !== 0)
  throw new Error(`CLI failed:\n${result.stdout}\n${result.stderr}`);
const report = JSON.parse(await readFile(join(outputDir, 'forensics-report.json'), 'utf8'));
if (report.failedAction?.apiName !== 'Locator.click')
  throw new Error(`Unexpected failed action: ${JSON.stringify(report.failedAction)}`);
if (!report.verdict?.confidence)
  throw new Error('Missing verdict confidence');
console.log('trace CLI smoke test passed');
