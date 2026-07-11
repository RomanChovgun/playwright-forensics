import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test, expect, stripAnsi } from '../fixtures.js';
import { matchPattern } from '../../src/analyzer/error-patterns.js';
import { parseErrorMessage } from '../../src/analyzer/error-parser.js';
import { diffDomTrees } from '../../src/analyzer/dom-diff.js';
import { traceSelector } from '../../src/analyzer/selector-tracer.js';
import { buildVerdict, renderVerdictText } from '../../src/analyzer/verdict-builder.js';
import { escapeHtml } from '../../src/escape.js';
import { loadConfig, resetConfigCache } from '../../src/config.js';
import { registerPlugin, getPlugin, runVerdictPlugins, runReportPlugins } from '../../src/plugin.js';
import type { DomNode } from '../../src/collector/dom-snapshot.js';
import type { ParsedError } from '../../src/analyzer/error-parser.js';
import type { Verdict } from '../../src/analyzer/verdict-builder.js';
import type { PluginContext } from '../../src/plugin.js';

test.describe('matchPattern', () => {
  test('classifies network error', () => {
    const result = matchPattern('net::ERR_CONNECTION_REFUSED');
    expect(result?.failureType).toBe('network-error');
  });

  test('classifies strict mode violation', () => {
    const result = matchPattern('strict mode violation');
    expect(result?.failureType).toBe('strict-mode-violation');
  });

  test('classifies locator timeout', () => {
    const result = matchPattern('element(s) not found');
    expect(result?.failureType).toBe('locator-timeout');
  });

  test('classifies not visible', () => {
    const result = matchPattern('element is not visible');
    expect(result?.failureType).toBe('not-visible');
  });

  test('classifies not enabled', () => {
    const result = matchPattern('element is not enabled');
    expect(result?.failureType).toBe('not-enabled');
  });

  test('classifies detached', () => {
    const result = matchPattern('Target detached from DOM');
    expect(result?.failureType).toBe('detached');
  });

  test('classifies assertion text mismatch', () => {
    const result = matchPattern("expect(locator).toHaveText()");
    expect(result?.failureType).toBe('assertion-text-mismatch');
  });

  test('classifies assertion count mismatch', () => {
    const result = matchPattern("expect(locator).toHaveCount()");
    expect(result?.failureType).toBe('assertion-count-mismatch');
  });

  test('specific beats general: wait-visible-enabled-stable before wait-visible', () => {
    const msg = 'waiting for element to be visible, enabled and stable';
    const result = matchPattern(msg);
    expect(result?.name).toBe('wait-visible-enabled-stable');
    expect(result?.failureType).toBe('locator-timeout');
  });

  test('returns undefined for unknown error', () => {
    const result = matchPattern('something completely unrelated');
    expect(result).toBeUndefined();
  });

  test('classifies dialog-blocking no longer exists (pattern removed)', () => {
    const result = matchPattern('There is an alert dialog blocking interaction');
    // The dialog-blocking pattern was removed — it's unreachable in Playwright v1.52+
    expect(result).toBeUndefined();
  });
});

test.describe('parseErrorMessage', () => {
  test('extracts locator from getByTestId', () => {
    const result = parseErrorMessage(`getByTestId('submit-btn')`);
    expect(result.locator).toBeDefined();
    expect(result.locator!.value).toBe('submit-btn');
    expect(result.locator!.type).toBe('getByTestId');
  });

  test('extracts locator with chain', () => {
    const result = parseErrorMessage(`getByTestId('list').getByText('Item 1')`);
    expect(result.locator).toBeDefined();
    expect(result.locator!.value).toBe('list');
    expect(result.locator!.chain).toHaveLength(1);
    expect(result.locator!.chain![0].value).toBe('Item 1');
  });

  test('extracts timeout value', () => {
    const result = parseErrorMessage('Timeout 5000ms exceeded');
    expect(result.timeoutMs).toBe(5000);
  });

  test('extracts network error code', () => {
    const result = parseErrorMessage('net::ERR_CONNECTION_REFUSED');
    expect(result.networkErrorCode).toBe('ERR_CONNECTION_REFUSED');
    expect(result.failureType).toBe('network-error');
  });

  test('extracts strict count', () => {
    const result = parseErrorMessage('strict mode violation: resolved to 3 elements');
    expect(result.strictCount).toBe(3);
  });

  test('extracts expected/actual for assertion-text-mismatch', () => {
    const result = parseErrorMessage(`expect(locator).toHaveText()\nExpected: "Hello"\nReceived: "World"`);
    expect(result.failureType).toBe('assertion-text-mismatch');
    expect(result.expectedValue).toBe('Hello');
    expect(result.actualValue).toBe('World');
  });

  test('extracts expected/actual for assertion-count-mismatch', () => {
    const result = parseErrorMessage(`expect(locator).toHaveCount()\nExpected: 3\nReceived: 1`);
    expect(result.failureType).toBe('assertion-count-mismatch');
    expect(result.expectedValue).toBe('3');
    expect(result.actualValue).toBe('1');
  });

  test('returns unknown for unrecognized error', () => {
    const result = parseErrorMessage('Something weird happened');
    expect(result.failureType).toBe('unknown');
  });

  test('classifies assertion-visibility', () => {
    const result = parseErrorMessage("expect(locator).toBeVisible()");
    expect(result.failureType).toBe('assertion-visibility');
  });

  test('classifies assertion-url-mismatch', () => {
    const result = parseErrorMessage("expect(locator).toHaveURL('https://example.com')");
    expect(result.failureType).toBe('assertion-url-mismatch');
  });

  test('classifies assertion-screenshot', () => {
    const result = parseErrorMessage("expect(locator).toHaveScreenshot()");
    expect(result.failureType).toBe('assertion-screenshot');
  });

  test('classifies assertion-api-response', () => {
    const result = parseErrorMessage("expect(locator).toBeOK()");
    expect(result.failureType).toBe('assertion-api-response');
  });

  test('classifies assertion-attribute-mismatch', () => {
    const result = parseErrorMessage("expect(locator).toHaveAttribute('href', '/foo')");
    expect(result.failureType).toBe('assertion-attribute-mismatch');
  });

  test('classifies assertion-other', () => {
    const result = parseErrorMessage("expect(locator).toBeChecked()");
    expect(result.failureType).toBe('assertion-other');
  });
});

test.describe('diffDomTrees', () => {
  const makeNode = (overrides: Partial<DomNode> = {}): DomNode => ({
    tag: 'div',
    attributes: {},
    children: [],
    visible: true,
    ...overrides,
  });

  test('detects added child', () => {
    const before = makeNode({ children: [] });
    const after = makeNode({ children: [makeNode({ tag: 'span' })] });
    const diffs = diffDomTrees(before, after);
    expect(diffs.some(d => d.type === 'added')).toBe(true);
  });

  test('detects removed child', () => {
    const before = makeNode({ children: [makeNode({ tag: 'span' })] });
    const after = makeNode({ children: [] });
    const diffs = diffDomTrees(before, after);
    expect(diffs.some(d => d.type === 'removed')).toBe(true);
  });

  test('detects class change', () => {
    const before = makeNode({ className: 'old' });
    const after = makeNode({ className: 'new' });
    const diffs = diffDomTrees(before, after);
    expect(diffs.some(d => d.type === 'changed' && d.oldValue === 'old' && d.newValue === 'new')).toBe(true);
  });

  test('detects text change', () => {
    const before = makeNode({ text: 'hello' });
    const after = makeNode({ text: 'world' });
    const diffs = diffDomTrees(before, after);
    expect(diffs.some(d => d.type === 'changed' && d.oldValue === 'hello' && d.newValue === 'world')).toBe(true);
  });

  test('detects boolean attribute change', () => {
    const before = makeNode({ booleanAttrs: ['disabled'] });
    const after = makeNode({ booleanAttrs: [] });
    const diffs = diffDomTrees(before, after);
    expect(diffs.some(d => d.type === 'changed' && d.oldValue === '[disabled]')).toBe(true);
  });

  test('detects attribute value change', () => {
    const before = makeNode({ attributes: { type: 'text' } });
    const after = makeNode({ attributes: { type: 'password' } });
    const diffs = diffDomTrees(before, after);
    expect(diffs.some(d => d.type === 'changed' && d.oldValue === 'type="text"' && d.newValue === 'type="password"')).toBe(true);
  });

  test('detects attribute addition', () => {
    const before = makeNode({ attributes: {} });
    const after = makeNode({ attributes: { placeholder: 'name' } });
    const diffs = diffDomTrees(before, after);
    expect(diffs.some(d => d.type === 'changed' && d.newValue === 'placeholder="name"')).toBe(true);
  });

  test('detects attribute removal', () => {
    const before = makeNode({ attributes: { placeholder: 'name' } });
    const after = makeNode({ attributes: {} });
    const diffs = diffDomTrees(before, after);
    expect(diffs.some(d => d.type === 'changed' && d.oldValue === 'placeholder="name"')).toBe(true);
  });

  test('ignores data-testid in attribute diff (handled by identity key)', () => {
    const before = makeNode({ attributes: { 'data-testid': 'foo', type: 'text' } });
    const after = makeNode({ attributes: { 'data-testid': 'bar', type: 'text' } });
    const diffs = diffDomTrees(before, after);
    // type stays same, data-testid excluded from attr diff
    expect(diffs.some(d => String(d.oldValue).includes('data-testid'))).toBe(false);
    expect(diffs.some(d => String(d.newValue).includes('data-testid'))).toBe(false);
  });

  test('matches children by id', () => {
    const child1 = makeNode({ tag: 'span', id: 'a' });
    const child2 = makeNode({ tag: 'span', id: 'b' });
    const before = makeNode({ children: [child1, child2] });
    const after = makeNode({ children: [child2, child1] }); // swapped
    const diffs = diffDomTrees(before, after);
    // No changes expected because same children just reordered
    expect(diffs.length).toBe(0);
  });

  test('matches children by data-testid', () => {
    const child1 = makeNode({ tag: 'span', attributes: { 'data-testid': 'a' } });
    const child2 = makeNode({ tag: 'span', attributes: { 'data-testid': 'b' } });
    const before = makeNode({ children: [child1, child2] });
    const after = makeNode({ children: [child2, child1] });
    const diffs = diffDomTrees(before, after);
    expect(diffs.length).toBe(0);
  });
});

test.describe('traceSelector', () => {
  test('finds element at failure step', () => {
    const snapshots: DomNode[] = [
      { tag: 'body', attributes: {}, children: [{ tag: 'div', attributes: { 'data-testid': 'foo' }, children: [], visible: true }], visible: true },
    ];
    const trace = traceSelector('foo', snapshots, 0, 'getByTestId');
    expect(trace.found).toBe(true);
    expect(trace.stepFound).toBe(0);
  });

  test('finds element in earlier step when not at failure step', () => {
    const snapshots: DomNode[] = [
      { tag: 'body', attributes: {}, children: [{ tag: 'div', attributes: { 'data-testid': 'foo' }, children: [], visible: true }], visible: true },
      { tag: 'body', attributes: {}, children: [], visible: true },
    ];
    const trace = traceSelector('foo', snapshots, 1, 'getByTestId');
    expect(trace.found).toBe(true);
    expect(trace.stepFound).toBe(0);
  });

  test('returns not found when element never existed', () => {
    const snapshots: DomNode[] = [
      { tag: 'body', attributes: {}, children: [], visible: true },
    ];
    const trace = traceSelector('nonexistent', snapshots, 0, 'getByTestId');
    expect(trace.found).toBe(false);
  });

  test('detects element removal between steps', () => {
    const makeDiv = (testId: string): DomNode => ({
      tag: 'div', attributes: { 'data-testid': testId }, children: [], visible: true,
    });
    const snapshots: DomNode[] = [
      { tag: 'body', attributes: {}, children: [makeDiv('foo')], visible: true },
      { tag: 'body', attributes: {}, children: [makeDiv('bar')], visible: true },
    ];
    const trace = traceSelector('foo', snapshots, 1, 'getByTestId');
    expect(trace.found).toBe(true);
    expect(trace.disappearanceChanges).toBeDefined();
    expect(trace.disappearanceChanges!.some(c => c.includes('removed from DOM'))).toBe(true);
  });

  test('reports element removed when testid changed (locator no longer matches)', () => {
    const snapshots: DomNode[] = [
      { tag: 'div', attributes: { 'data-testid': 'foo' }, children: [], visible: true },
      { tag: 'div', attributes: { 'data-testid': 'bar' }, children: [], visible: true },
    ];
    const trace = traceSelector('foo', snapshots, 1);
    expect(trace.found).toBe(true);
    expect(trace.disappearanceChanges).toBeDefined();
    expect(trace.disappearanceChanges!.some(c => c.includes('removed from DOM'))).toBe(true);
  });

  test('detects data-testid removed — element no longer matches locator', () => {
    const snapshots: DomNode[] = [
      { tag: 'div', attributes: { 'data-testid': 'foo' }, children: [], visible: true },
      { tag: 'div', attributes: {}, children: [], visible: true },
    ];
    const trace = traceSelector('foo', snapshots, 1, 'getByTestId');
    expect(trace.found).toBe(true);
    // data-testid was removed → locator no longer matches at step 1 → reported as removed from DOM
    expect(trace.disappearanceChanges!.some(c => c.includes('removed from DOM'))).toBe(true);
  });

  test('detects data-testid added — element becomes matchable', () => {
    const snapshots: DomNode[] = [
      { tag: 'div', attributes: {}, children: [], visible: true },
      { tag: 'div', attributes: { 'data-testid': 'bar' }, children: [], visible: true },
    ];
    const trace = traceSelector('bar', snapshots, 1, 'getByTestId');
    expect(trace.found).toBe(true);
    // element is found at failure step → actionability message, not a detailed change list
    expect(trace.disappearanceChanges![0]).toContain('actionability checks');
  });

  test('finds element at failure step when properties changed but testid stable', () => {
    const snapshots: DomNode[] = [
      { tag: 'div', attributes: { 'data-testid': 'foo' }, className: 'old', text: 'hello', children: [], visible: true },
      { tag: 'div', attributes: { 'data-testid': 'foo' }, className: 'new', text: 'world', children: [], visible: false, booleanAttrs: ['disabled'] },
    ];
    const trace = traceSelector('foo', snapshots, 1, 'getByTestId');
    expect(trace.found).toBe(true);
    expect(trace.stepFound).toBe(1);
    // Still found at failure step, but actionability changes are not detailed in disappearanceChanges
    expect(trace.disappearanceChanges!.some(c => c.includes('actionability checks'))).toBe(true);
  });

  test('finds element even when tag changes if testid stays the same', () => {
    const snapshots: DomNode[] = [
      { tag: 'div', attributes: { 'data-testid': 'foo' }, children: [], visible: true },
      { tag: 'span', attributes: { 'data-testid': 'foo' }, children: [], visible: true },
    ];
    const trace = traceSelector('foo', snapshots, 1, 'getByTestId');
    expect(trace.found).toBe(true);
    // The data-testid is the same, so the element is "found" even though the tag changed
    expect(trace.stepFound).toBe(1);
  });
});

test.describe('buildVerdict', () => {
  test('returns verdict with explanation for locator-timeout', () => {
    const parsed = { failureType: 'locator-timeout' as const, rawMessage: '' };
    const verdict = buildVerdict(parsed);
    expect(verdict.failureType).toBe('locator-timeout');
    expect(verdict.explanation).toBe('Selector "" was never found in the DOM within the timeout.');
    expect(verdict.recommendation).toBe('Use a more specific locator, increase timeout, or wait for the element to appear with waitForSelector()');
  });

  test('returns verdict with selector info for network-error', () => {
    const parsed = { failureType: 'network-error' as const, networkErrorCode: 'ERR_CONNECTION_REFUSED', rawMessage: '' };
    const verdict = buildVerdict(parsed);
    expect(verdict.explanation).toContain('ERR_CONNECTION_REFUSED');
    expect(verdict.category).toBe('network');
  });

  test('handles unknown failure type gracefully', () => {
    const parsed = { failureType: 'unknown' as const, rawMessage: 'some error' };
    const verdict = buildVerdict(parsed);
    expect(verdict.category).toBe('unknown');
    expect(verdict.explanation).toBe('An unknown error occurred while interacting with "".');
  });

  test('renders verdict text without errors', () => {
    const parsed = { failureType: 'not-visible' as const, rawMessage: '' };
    const verdict = buildVerdict(parsed);
    const text = renderVerdictText(verdict);
    expect(text).toContain('👻');
    expect(text).toContain('Recommendation');
  });

  test('builds assertion-attribute-mismatch verdict', () => {
    const parsed = { failureType: 'assertion-attribute-mismatch' as const, rawMessage: '' };
    const verdict = buildVerdict(parsed);
    expect(verdict.label).toBe('Attribute Assertion Failed');
    expect(verdict.category).toBe('assertion');
    expect(verdict.recommendation).toBe('Verify the attribute value is correct, or use a more flexible matching pattern');
  });

  test('builds assertion-visibility verdict', () => {
    const parsed = { failureType: 'assertion-visibility' as const, rawMessage: '' };
    const verdict = buildVerdict(parsed);
    expect(verdict.label).toBe('Visibility Assertion Failed');
    expect(verdict.category).toBe('assertion');
  });

  test('builds assertion-url-mismatch verdict', () => {
    const parsed = { failureType: 'assertion-url-mismatch' as const, rawMessage: '' };
    const verdict = buildVerdict(parsed);
    expect(verdict.label).toBe('URL/Title Assertion Failed');
    expect(verdict.category).toBe('assertion');
  });

  test('builds assertion-screenshot verdict', () => {
    const parsed = { failureType: 'assertion-screenshot' as const, rawMessage: '' };
    const verdict = buildVerdict(parsed);
    expect(verdict.label).toBe('Screenshot Assertion Failed');
    expect(verdict.category).toBe('assertion');
  });

  test('builds assertion-api-response verdict', () => {
    const parsed = { failureType: 'assertion-api-response' as const, rawMessage: '' };
    const verdict = buildVerdict(parsed);
    expect(verdict.label).toBe('API Response Assertion Failed');
    expect(verdict.category).toBe('assertion');
  });

  test('builds assertion-other verdict', () => {
    const parsed = { failureType: 'assertion-other' as const, rawMessage: '' };
    const verdict = buildVerdict(parsed);
    expect(verdict.label).toBe('Assertion Failed');
    expect(verdict.category).toBe('assertion');
  });
});

test.describe('stripAnsi', () => {
  test('strips basic ANSI codes', () => {
    expect(stripAnsi('\x1B[31mhello\x1B[0m')).toBe('hello');
  });

  test('strips complex ANSI codes with semicolons', () => {
    expect(stripAnsi('\x1B[38;5;196mred\x1B[0m')).toBe('red');
  });

  test('strips bold ANSI codes', () => {
    expect(stripAnsi('\x1B[1;31mbold red\x1B[0m')).toBe('bold red');
  });
});

test.describe('escapeHtml', () => {
  test('escapes & < > " \'', () => {
    expect(escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  test('passes through normal text', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  test('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  test('escapes ampersand inside entity-like strings (no unescape logic)', () => {
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });
});

test.describe('plugin system', () => {
  test('registerPlugin and getPlugin work', () => {
    const plugin = { name: 'test-plugin', onVerdict: () => ({}) as Verdict };
    registerPlugin(plugin);
    expect(getPlugin('test-plugin')).toBe(plugin);
  });

  test('getPlugin returns undefined for unknown plugin', () => {
    expect(getPlugin('nonexistent')).toBeUndefined();
  });

  test('runVerdictPlugins transforms verdict', () => {
    const plugin = {
      name: 'verdict-modifier',
      onVerdict: (v: Verdict) => ({ ...v, explanation: 'modified' }),
    };
    const input = { failureType: 'unknown' as const, rawMessage: '' };
    const result = runVerdictPlugins([plugin], buildVerdict(input), input, {} as PluginContext);
    expect(result.explanation).toBe('modified');
  });

  test('runReportPlugins transforms report', () => {
    const plugin = {
      name: 'report-modifier',
      onReport: () => ({ text: 'modified text', html: 'modified html' }),
    };
    const result = runReportPlugins([plugin], 'original text', 'original html', {} as PluginContext);
    expect(result.text).toBe('modified text');
    expect(result.html).toBe('modified html');
  });

  test('runVerdictPlugins skips plugins without onVerdict', () => {
    const plugin = { name: 'no-op' };
    const input = { failureType: 'unknown' as const, rawMessage: '' };
    const result = runVerdictPlugins([plugin as never], buildVerdict(input), input, {} as PluginContext);
    expect(result).toBeDefined();
  });
});

test.describe('loadConfig', () => {
  const tmpDirs: string[] = [];

  test.afterEach(async () => {
    for (const d of tmpDirs) {
      await rm(d, { recursive: true, force: true }).catch(() => {});
    }
    tmpDirs.length = 0;
    resetConfigCache();
  });

  test('returns default empty config when no files exist', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'forensics-test-'));
    tmpDirs.push(tmp);
    const config = await loadConfig(tmp);
    expect(config).toEqual({});
  });

  test('reads .forensicsrc.json', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'forensics-test-'));
    tmpDirs.push(tmp);
    await writeFile(join(tmp, '.forensicsrc.json'), JSON.stringify({ snapshotCount: 5 }));
    const config = await loadConfig(tmp);
    expect(config.snapshotCount).toBe(5);
  });

  test('reads forensics.config.json', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'forensics-test-'));
    tmpDirs.push(tmp);
    await writeFile(join(tmp, 'forensics.config.json'), JSON.stringify({ plugins: ['./my-plugin.js'] }));
    const config = await loadConfig(tmp);
    expect(config.plugins).toEqual(['./my-plugin.js']);
  });

  test('reads forensics from package.json', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'forensics-test-'));
    tmpDirs.push(tmp);
    await writeFile(join(tmp, 'package.json'), JSON.stringify({ forensics: { snapshotCount: 10 } }));
    const config = await loadConfig(tmp);
    expect(config.snapshotCount).toBe(10);
  });

  test('caches config after first load', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'forensics-test-'));
    tmpDirs.push(tmp);
    await writeFile(join(tmp, '.forensicsrc'), JSON.stringify({ snapshotCount: 3 }));
    const first = await loadConfig(tmp);
    expect(first.snapshotCount).toBe(3);
    await writeFile(join(tmp, '.forensicsrc'), JSON.stringify({ snapshotCount: 99 }));
    const second = await loadConfig(tmp);
    expect(second.snapshotCount).toBe(3);
    resetConfigCache();
    const third = await loadConfig(tmp);
    expect(third.snapshotCount).toBe(99);
  });

  test('ignores unknown keys with warning', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'forensics-test-'));
    tmpDirs.push(tmp);
    await writeFile(join(tmp, '.forensicsrc'), JSON.stringify({ unknownKey: true, snapshotCount: 1 }));
    const config = await loadConfig(tmp);
    expect(config.snapshotCount).toBe(1);
  });
});
