import { test as base } from '@playwright/test';
import type { TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { EOL } from 'node:os';
import { collectDomSnapshot } from './collector/dom-snapshot.js';
import type { DomNode } from './collector/dom-snapshot.js';
import { startMutationLog, stopMutationLog } from './collector/mutation-log.js';
import type { MutationRecord } from './collector/mutation-log.js';
import { traceSelector } from './analyzer/selector-tracer.js';
import type { SelectorTrace } from './analyzer/selector-tracer.js';
import { diffDomTrees } from './analyzer/dom-diff.js';
import type { DiffResult } from './analyzer/dom-diff.js';
import { generateHtmlReport } from './reporter/html-report.js';
import { parseErrorMessage } from './analyzer/error-parser.js';
import { buildVerdict, renderVerdictText } from './analyzer/verdict-builder.js';
import type { Verdict } from './analyzer/verdict-builder.js';
import { loadConfig } from './config.js';
import type { ForensicsConfig } from './config.js';
import { loadPlugins, runVerdictPlugins, runReportPlugins } from './plugin.js';
import type { ForensicsPlugin, PluginContext } from './plugin.js';

export interface ForensicsFixture {
  forensics: {
    snapshot: () => Promise<void>;
    history: readonly DomNode[];
    startMutationLog: () => Promise<void>;
    mutationLogs: readonly MutationRecord[][];
  };
}

let loadedPlugins: ForensicsPlugin[] | null = null;
let config: ForensicsConfig | null = null;

async function getPlugins(): Promise<ForensicsPlugin[]> {
  if (loadedPlugins) return loadedPlugins;
  if (!config) config = await loadConfig();
  if (config.plugins && config.plugins.length > 0) {
    loadedPlugins = await loadPlugins(config.plugins);
  } else {
    loadedPlugins = [];
  }
  return loadedPlugins;
}

export function stripAnsi(s: string): string {
  return s.replace(/\x1B\[[\d;]+m/g, '');
}

export const test = base.extend<ForensicsFixture>({
  forensics: async ({ page }, use, testInfo) => {
    const history: DomNode[] = [];
    const mutationLogs: MutationRecord[][] = [];
    let mutationLogActive = false;

    const snapshot = async () => {
      if (page.isClosed()) return;
      try {
        const dom = await page.evaluate(collectDomSnapshot);
        history.push(dom);
        if (config?.snapshotCount && history.length > config.snapshotCount) {
          history.splice(0, history.length - config.snapshotCount);
        }
      } catch (e) {
        // suppress expected page-closed errors, warn on unexpected ones
        const msg = String(e);
        if (!/closed|Target destroyed/i.test(msg)) {
          console.warn(`[forensics] snapshot() unexpected error:`, e);
        }
      }
    };

    const startLogging = async () => {
      if (page.isClosed()) return;
      try {
        await page.evaluate(startMutationLog);
        mutationLogActive = true;
      } catch {
        // page may be closed
      }
    };

    await snapshot();
    await use({
      snapshot,
      get history() { return Object.freeze(history.slice()); },
      startMutationLog: startLogging,
      get mutationLogs() { return Object.freeze(mutationLogs.map(b => Object.freeze(b))) as unknown as readonly MutationRecord[][]; },
    });

    if (mutationLogActive) {
      if (page.isClosed()) return;
      try {
        const records = await page.evaluate(stopMutationLog) as MutationRecord[];
        if (records && records.length > 0) mutationLogs.push(records);
      } catch {
        // page may be closed
      }
    }

    if ((testInfo.status === 'failed' || testInfo.status === 'timedOut') && history.length > 0) {
      try {
        const plugins = await getPlugins();
        await generateReport(testInfo, history, mutationLogs, plugins);
      } catch (e) {
        console.error('[forensics] error:', e);
      }
    }
  },
});

async function generateReport(
  testInfo: TestInfo,
  history: DomNode[],
  mutationLogs: MutationRecord[][],
  plugins: ForensicsPlugin[],
) {
  const rawError = testInfo.error?.message ?? '';
  const errorMessage = stripAnsi(rawError);

  const parsed = parseErrorMessage(rawError);

  const diffs = history.length >= 2
    ? diffDomTrees(history[history.length - 2], history[history.length - 1])
    : [];

  const l = parsed.locator;
  const locatorValue = l?.value;
  const locatorType = l?.type;

  let trace: SelectorTrace | undefined;
  if (locatorValue && locatorType && history.length > 1) {
    trace = traceSelector(locatorValue, history, history.length - 1, locatorType);
  }

  let verdict = buildVerdict(parsed, trace, history, diffs);

  const pluginContext: PluginContext = {
    testName: testInfo.title,
    errorMessage,
    history,
    diffs,
    trace,
    mutationLogCount: mutationLogs.length,
    networkErrorCode: parsed.networkErrorCode,
  };

  if (plugins.length > 0) {
    verdict = runVerdictPlugins(plugins, verdict, parsed, pluginContext);
  }

  if (history.length === 0) {
    history.push({ tag: '#document', attributes: {}, children: [], visible: false });
  }

  let report = buildTextReport(testInfo.title, errorMessage, history, diffs, verdict, mutationLogs);
  let html = generateHtmlReport({
    testName: testInfo.title,
    errorMessage,
    history,
    diffs,
    trace,
    verdict,
    mutationLogs,
  });

  if (plugins.length > 0) {
    const modified = runReportPlugins(plugins, report, html, pluginContext);
    report = modified.text;
    html = modified.html;
  }

  const txtPath = testInfo.outputPath('forensics-report.txt');
  const htmlPath = testInfo.outputPath('forensics-report.html');
  await writeFile(txtPath, report, 'utf-8');
  await writeFile(htmlPath, html, 'utf-8');

  await testInfo.attach('forensics-report-txt', {
    path: txtPath,
    contentType: 'text/plain',
  });
  await testInfo.attach('forensics-report', {
    path: htmlPath,
    contentType: 'text/html',
  });
}

function buildTextReport(
  testName: string,
  errorMessage: string,
  history: DomNode[],
  diffs: DiffResult[],
  verdict: Verdict,
  mutationLogs: MutationRecord[][],
): string {
  const lines: string[] = [
    '=== PLAYWRIGHT FORENSICS REPORT ===',
    `Test: ${testName}`,
    `Error: ${errorMessage}`,
    `DOM snapshots: ${history.length}`,
    '',
  ];

  lines.push('--- CAUSAL ANALYSIS ---');
  lines.push(renderVerdictText(verdict));
  lines.push('');

  if (mutationLogs.length > 0) {
    lines.push('--- MUTATION LOG ---');
    for (let i = 0; i < mutationLogs.length; i++) {
      lines.push(`  Batch ${i + 1}: ${mutationLogs[i].length} mutations`);
      for (const m of mutationLogs[i].slice(0, 10)) {
        let desc = `    [${m.type}] ${m.target}`;
        if (m.attributeName) desc += ` attr="${m.attributeName}"`;
        if (m.addedNodes > 0) desc += ` +${m.addedNodes} nodes`;
        if (m.removedNodes > 0) desc += ` -${m.removedNodes} nodes`;
        lines.push(desc);
      }
      if (mutationLogs[i].length > 10) {
        lines.push(`    ... and ${mutationLogs[i].length - 10} more`);
      }
    }
    lines.push('');
  }

  if (diffs.length > 0) {
    lines.push('--- DOM DIFF (last 2 snapshots) ---');
    for (const d of diffs) {
      lines.push(`  [${d.type}] ${d.path}`);
      if (d.oldValue) lines.push(`    was: ${d.oldValue}`);
      if (d.newValue) lines.push(`    now: ${d.newValue}`);
    }
    lines.push('');
  }

  return lines.join(EOL);
}

export { expect } from '@playwright/test';
