import { test, expect } from '../fixtures.js';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { zipSync, strToU8 } from 'fflate';
import { parseLocatorExpression } from '../../src/analyzer/locator/parser.js';
import { queryLocator } from '../../src/analyzer/locator/engine.js';
import { diffDomTrees } from '../../src/analyzer/dom-diff.js';
import { readPlaywrightTrace } from '../../src/trace/trace-reader.js';
import type { TraceEvidence } from '../../src/trace/trace-reader.js';
import { decodeFrameSnapshots } from '../../src/trace/snapshot-decoder.js';
import { analyzeFailure } from '../../src/analyzer/analysis-pipeline.js';
import { analyzeTraceFile } from '../../src/trace/analyze-trace.js';
import { writeFailureReports } from '../../src/reporter/artifacts.js';
import { generateHtmlReport } from '../../src/reporter/html-report.js';
import { buildVerdict } from '../../src/analyzer/verdict-builder.js';
import type { DomNode } from '../../src/collector/dom-snapshot.js';
import { DEFAULT_CONFIG } from '../../src/config.js';

const node = (overrides: Partial<DomNode> = {}): DomNode => ({
  tag: 'div', attributes: {}, children: [], visible: true, ...overrides,
});

test.describe('locator AST and engine', () => {
  test('parses chains, role name regex, filter and nth in source order', () => {
    const expression = parseLocatorExpression(
      `Locator: getByTestId('list').getByRole('button', { name: /save/i }).filter({ hasText: 'now' }).nth(1)`,
    )!;
    expect(expression.steps.map(step => step.kind)).toEqual(['testId', 'role', 'filter', 'nth']);
    expect(expression.steps[1]).toMatchObject({ kind: 'role', role: 'button', name: { value: 'save', regex: true, flags: 'i' } });
  });

  test('matches implicit role and accessible name inside chain', () => {
    const root = node({ children: [
      node({ attributes: { 'data-testid': 'other' }, children: [node({ tag: 'button', implicitRole: 'button', accessibleName: 'Save' })] }),
      node({ attributes: { 'data-testid': 'list' }, children: [node({ tag: 'button', implicitRole: 'button', accessibleName: 'Save' })] }),
    ] });
    const expression = parseLocatorExpression(`getByTestId('list').getByRole('button', { name: 'Save', exact: true })`)!;
    const result = queryLocator(root, expression);
    expect(result.nodes).toHaveLength(1);
    expect(result.confidence).toBe('confirmed');
  });

  test('does not match body by descendant text', () => {
    const leaf = node({ tag: 'span', directText: 'Save' });
    const body = node({ tag: 'body', text: 'Save', children: [leaf] });
    const result = queryLocator(body, parseLocatorExpression(`getByText('Save', { exact: true })`)!);
    expect(result.nodes).toEqual([leaf]);
  });

  test('supports CSS and basic XPath locators', () => {
    const button = node({ tag: 'button', id: 'save', className: 'primary', attributes: { id: 'save' } });
    const root = node({ children: [button] });
    expect(queryLocator(root, parseLocatorExpression(`locator('button.primary')`)!).nodes).toEqual([button]);
    expect(queryLocator(root, parseLocatorExpression(`locator('xpath=//button[@id="save"]')`)!).nodes).toEqual([button]);
  });
});

test.describe('identity-aware diff', () => {
  test('treats fallback reorder as moves, not additions/removals', () => {
    const first = node({ tag: 'span', directText: 'first' });
    const second = node({ tag: 'span', directText: 'second' });
    const diffs = diffDomTrees(node({ children: [first, second] }), node({ children: [second, first] }));
    expect(diffs.filter(diff => diff.type === 'moved')).toHaveLength(2);
    expect(diffs.some(diff => diff.type === 'added' || diff.type === 'removed')).toBe(false);
  });

  test('treats fallback text mutation as changed', () => {
    const before = node({ children: [node({ tag: 'span', directText: 'before' })] });
    const after = node({ children: [node({ tag: 'span', directText: 'after' })] });
    const diffs = diffDomTrees(before, after);
    expect(diffs.some(diff => diff.type === 'changed' && diff.oldValue === 'before' && diff.newValue === 'after')).toBe(true);
    expect(diffs.some(diff => diff.type === 'added' || diff.type === 'removed')).toBe(false);
  });
});

test.describe('trace and report safety', () => {
  test('extracts version-tolerant action, network and console evidence', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'forensics-trace-'));
    const path = join(dir, 'trace.zip');
    const jsonl = [
      JSON.stringify({ type: 'context-options', version: 8 }),
      JSON.stringify({ type: 'before', callId: 'call@1', class: 'Locator', method: 'click', params: { selector: '#save' }, startTime: 1, wallTime: 1_700_000_000_000 }),
      JSON.stringify({ type: 'after', callId: 'call@1', endTime: 2, error: { message: 'Timeout 100ms exceeded' } }),
      JSON.stringify({ type: 'resource-snapshot', snapshot: { request: { method: 'GET', url: 'https://x.test/?token=secret' }, response: { status: 500 } } }),
      JSON.stringify({ type: 'console', messageType: 'error', text: 'boom' }),
    ].join('\n');
    await writeFile(path, zipSync({ '0-trace.trace': strToU8(jsonl) }));
    const trace = await readPlaywrightTrace(path, { maxEvents: 20, redact: value => value.replace('secret', '[REDACTED]') });
    expect(trace.actions).toHaveLength(1);
    expect(trace.traceVersion).toBe(8);
    expect(trace.actions[0].error).toContain('Timeout');
    expect(trace.actions[0].wallTime).toBe(1_700_000_000_000);
    expect(trace.network[0]).toMatchObject({ method: 'GET', status: 500 });
    expect(trace.network[0].url).not.toContain('secret');
    expect(trace.console[0].text).toBe('boom');
  });

  test('corrupt traces degrade to a warning', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'forensics-trace-'));
    const path = join(dir, 'trace.zip');
    await writeFile(path, 'not a zip');
    const trace = await readPlaywrightTrace(path, { maxEvents: 20, redact: value => value });
    expect(trace.warnings[0]).toContain('could not be parsed');
    await expect(analyzeTraceFile(path, { outputDir: join(dir, 'report') })).rejects.toThrow('could not be parsed');
  });

  test('normalizes legacy action events and warns on future trace versions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'forensics-trace-'));
    const path = join(dir, 'trace.zip');
    const jsonl = [
      JSON.stringify({ type: 'context-options', version: 9 }),
      JSON.stringify({
        type: 'action',
        metadata: {
          id: 'legacy@1',
          type: 'Page',
          method: 'click',
          apiName: 'page.click',
          params: { selector: '#save' },
          startTime: 1,
          endTime: 2,
          error: { message: 'legacy failure' },
        },
      }),
    ].join('\n');
    await writeFile(path, zipSync({ '0-trace.trace': strToU8(jsonl) }));
    const trace = await readPlaywrightTrace(path, { maxEvents: 20, redact: value => value });
    expect(trace.actions[0]).toMatchObject({ callId: 'legacy@1', apiName: 'page.click', error: 'legacy failure' });
    expect(trace.warnings).toContain('Trace version 9 is outside the tested compatibility range 3-8');
  });

  test('HTML escapes script payloads and supports keyboard navigation', () => {
    const parsed = { failureType: 'unknown' as const, rawMessage: 'x' };
    const html = generateHtmlReport({
      testName: '</title><script>alert(1)</script>',
      errorMessage: '<script>alert(2)</script>',
      history: [node({ directText: '</script><script>alert(3)</script>' })],
      diffs: [],
      verdict: buildVerdict(parsed),
      snapshotLimit: 25,
    });
    expect(html).not.toContain('</script><script>alert(3)');
    expect(html).toContain(`event.key === 'ArrowLeft'`);
  });

  test('decodes Playwright snapshot references and analyzes without fixture snapshots', async () => {
    const trace: TraceEvidence = {
      source: 'trace.zip',
      traceVersion: 8,
      actions: [{
        callId: 'call@1',
        apiName: 'Locator.click',
        selector: 'internal:testid=[data-testid="save"s]',
        error: 'TimeoutError: locator.click: Timeout 100ms exceeded.',
      }],
      network: [],
      console: [],
      warnings: [],
      truncated: false,
      frameSnapshots: [
        {
          snapshotName: 'before@call@1',
          callId: 'call@1',
          pageId: 'page@1',
          frameId: 'frame@1',
          frameUrl: 'https://example.test/',
          timestamp: 1,
          isMainFrame: true,
          html: ['HTML', {}, ['BODY', {}, ['BUTTON', { 'data-testid': 'save' }, 'Save']]],
        },
        {
          snapshotName: 'after@call@1',
          callId: 'call@1',
          pageId: 'page@1',
          frameId: 'frame@1',
          frameUrl: 'https://example.test/',
          timestamp: 2,
          isMainFrame: true,
          html: [[1, 3]],
        },
      ],
    };
    const decoded = decodeFrameSnapshots(trace.frameSnapshots, DEFAULT_CONFIG);
    expect(decoded.history).toHaveLength(2);
    expect(decoded.history[1].children[0].children[0].attributes['data-testid']).toBe('save');
    const analysis = analyzeFailure({ traceEvidence: trace, config: DEFAULT_CONFIG });
    expect(analysis.history).toHaveLength(2);
    expect(analysis.verdict.evidence).toContain('Failed trace action: Locator.click');
    const outputDir = await mkdtemp(join(tmpdir(), 'forensics-output-'));
    const paths = await writeFailureReports({
      outputDir,
      testName: 'trace-only failure',
      analysis,
      snapshotLimit: 25,
    });
    expect(await readFile(paths.html, 'utf8')).toContain('Playwright Trace Evidence');
    expect(JSON.parse(await readFile(paths.json, 'utf8')).trace.frameSnapshots).toBeUndefined();
  });
});
