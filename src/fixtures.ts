import { test as base } from '@playwright/test';
import type { TestInfo } from '@playwright/test';
import { access, writeFile } from 'node:fs/promises';
import { EOL } from 'node:os';
import { collectDomSnapshot } from './collector/dom-snapshot.js';
import type { DomNode } from './collector/dom-snapshot.js';
import { flushMutationLog, startMutationLog } from './collector/mutation-log.js';
import type { MutationBatch, MutationFlush, MutationRecord } from './collector/mutation-log.js';
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
import { readPlaywrightTrace } from './trace/trace-reader.js';
import type { TraceEvidence } from './trace/trace-reader.js';

export interface ForensicsFixture {
  forensics: {
    snapshot: () => Promise<void>;
    history: readonly DomNode[];
    config: Readonly<ForensicsConfig>;
    startMutationLog: () => Promise<void>;
    mutationLogs: readonly MutationBatch[];
  };
}

interface ForensicsWorkerFixtures {
  _forensicsConfig: ForensicsConfig;
  _forensicsPlugins: ForensicsPlugin[];
}

export function stripAnsi(s: string): string {
  return s.replace(/\x1B\[[\d;]+m/g, '');
}

export function redactSensitiveText(value: string, config: Pick<ForensicsConfig, 'redaction'>): string {
  if (!config.redaction.enabled) return value;
  const replacement = config.redaction.replacement;
  let safe = value
    .replace(/([?&](?:token|secret|password|passwd|api[_-]?key|auth|session)=)[^&#\s]*/gi, `$1${replacement}`)
    .replace(/\b(authorization|cookie|set-cookie)\s*[:=]\s*[^\s,;]+/gi, `$1: ${replacement}`);
  if (config.redaction.urlQuery) {
    safe = safe.replace(/(https?:\/\/[^\s?#]+)\?[^\s#]*/gi, `$1?${replacement}`);
  }
  for (const pattern of config.redaction.textPatterns) {
    try { safe = safe.replace(new RegExp(pattern, 'gi'), replacement); } catch { /* invalid user pattern */ }
  }
  return safe;
}

export const test = base.extend<ForensicsFixture, ForensicsWorkerFixtures>({
  _forensicsConfig: [async ({}, use) => {
    await use(await loadConfig());
  }, { scope: 'worker' }],
  _forensicsPlugins: [async ({ _forensicsConfig }, use) => {
    await use(_forensicsConfig.plugins.length > 0 ? await loadPlugins(_forensicsConfig.plugins) : []);
  }, { scope: 'worker' }],
  forensics: async ({ page, _forensicsConfig, _forensicsPlugins }, use, testInfo) => {
    const history: DomNode[] = [];
    const mutationLogs: MutationBatch[] = [];
    let mutationLogActive = false;
    let mutationStartedAt = 0;
    let snapshotSequence = 0;
    const mutationOptions = {
      maxRecords: _forensicsConfig.maxMutationRecords,
      maxTextLength: _forensicsConfig.maxTextLength,
      redaction: _forensicsConfig.redaction,
    };

    const flushMutations = async (snapshotIndex: number, restart: boolean) => {
      if (!mutationLogActive || page.isClosed()) return;
      const flushed = await page.evaluate(flushMutationLog) as MutationFlush;
      if (flushed.records.length > 0 || flushed.dropped > 0) {
        const batch = flushed.records as MutationBatch;
        Object.assign(batch, {
          snapshotIndex,
          startedAt: mutationStartedAt,
          flushedAt: Date.now(),
          dropped: flushed.dropped,
        });
        mutationLogs.push(batch);
      }
      mutationLogActive = false;
      if (restart && !page.isClosed()) {
        mutationStartedAt = Date.now();
        await page.evaluate(startMutationLog, mutationOptions);
        mutationLogActive = true;
      }
    };

    const snapshot = async () => {
      if (page.isClosed()) return;
      const shouldRestartMutations = mutationLogActive;
      try {
        if (mutationLogActive) await flushMutations(snapshotSequence, false);
        const dom = await page.evaluate(collectDomSnapshot, {
          maxNodes: _forensicsConfig.maxNodes,
          maxSnapshotBytes: _forensicsConfig.maxSnapshotBytes,
          maxTextLength: _forensicsConfig.maxTextLength,
          redaction: _forensicsConfig.redaction,
        });
        history.push(dom);
        snapshotSequence++;
        if (history.length > _forensicsConfig.snapshotCount) {
          history.splice(0, history.length - _forensicsConfig.snapshotCount);
        }
      } catch (e) {
        // suppress expected page-closed errors, warn on unexpected ones
        const msg = String(e);
        if (!/closed|Target destroyed/i.test(msg)) {
          console.warn(`[forensics] snapshot() unexpected error:`, e);
        }
      } finally {
        if (shouldRestartMutations && !mutationLogActive && !page.isClosed()) {
          try {
            mutationStartedAt = Date.now();
            await page.evaluate(startMutationLog, mutationOptions);
            mutationLogActive = true;
          } catch {
            // page may close while restarting
          }
        }
      }
    };

    const startLogging = async () => {
      if (page.isClosed()) return;
      try {
        if (mutationLogActive) await flushMutations(snapshotSequence, false);
        mutationStartedAt = Date.now();
        await page.evaluate(startMutationLog, mutationOptions);
        mutationLogActive = true;
      } catch {
        // page may be closed
      }
    };

    await snapshot();
    await use({
      snapshot,
      get history() { return Object.freeze(history.slice()); },
      config: Object.freeze(_forensicsConfig),
      startMutationLog: startLogging,
      get mutationLogs() { return Object.freeze(mutationLogs.map(b => Object.freeze(b))) as readonly MutationBatch[]; },
    });

    if (mutationLogActive) {
      if (!page.isClosed()) {
        try {
          await flushMutations(snapshotSequence, false);
        } catch {
          // page may close during teardown
        }
      }
    }

    if ((testInfo.status === 'failed' || testInfo.status === 'timedOut') && history.length > 0) {
      try {
        await generateReport(testInfo, history, mutationLogs, _forensicsPlugins, _forensicsConfig);
      } catch (e) {
        console.error('[forensics] error:', e);
      }
    }
  },
});

async function generateReport(
  testInfo: TestInfo,
  history: DomNode[],
  mutationLogs: MutationBatch[],
  plugins: ForensicsPlugin[],
  config: ForensicsConfig,
) {
  const rawError = testInfo.error?.message ?? '';
  const errorMessage = redactSensitiveText(stripAnsi(rawError), config);

  const parsed = parseErrorMessage(errorMessage);
  const traceEvidence = await collectTraceEvidence(testInfo, config, history);

  const diffs = history.length >= 2
    ? diffDomTrees(history[history.length - 2], history[history.length - 1])
    : [];

  const l = parsed.locator;
  let trace: SelectorTrace | undefined;
  if (l?.expression && history.length > 1) {
    trace = traceSelector(l.expression, history, history.length - 1);
  } else if (l?.value && l.type && history.length > 1) {
    trace = traceSelector(l.value, history, history.length - 1, l.type);
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
    traceEvidence,
  };

  if (plugins.length > 0) {
    verdict = runVerdictPlugins(plugins, verdict, parsed, pluginContext);
  }

  if (history.length === 0) {
    history.push({ tag: '#document', attributes: {}, children: [], visible: false });
  }

  let report = buildTextReport(testInfo.title, errorMessage, history, diffs, verdict, mutationLogs, traceEvidence);
  let html = generateHtmlReport({
    testName: testInfo.title,
    errorMessage,
    history,
    diffs,
    trace,
    verdict,
    mutationLogs,
    traceEvidence,
    snapshotLimit: config.snapshotCount,
  });

  if (plugins.length > 0) {
    const modified = runReportPlugins(plugins, report, html, pluginContext);
    report = modified.text;
    html = modified.html;
  }

  const txtPath = testInfo.outputPath('forensics-report.txt');
  const htmlPath = testInfo.outputPath('forensics-report.html');
  const jsonPath = testInfo.outputPath('forensics-report.json');
  await writeFile(txtPath, report, 'utf-8');
  await writeFile(htmlPath, html, 'utf-8');
  await writeFile(jsonPath, JSON.stringify({
    schemaVersion: 2,
    testName: testInfo.title,
    errorMessage,
    verdict,
    diffs,
    mutationLogs,
    trace: traceEvidence,
    snapshots: history,
  }, null, 2), 'utf-8');

  await testInfo.attach('forensics-report-txt', {
    path: txtPath,
    contentType: 'text/plain',
  });
  await testInfo.attach('forensics-report', {
    path: htmlPath,
    contentType: 'text/html',
  });
  await testInfo.attach('forensics-report-json', {
    path: jsonPath,
    contentType: 'application/json',
  });
}

async function collectTraceEvidence(
  testInfo: TestInfo,
  config: ForensicsConfig,
  history: DomNode[],
): Promise<TraceEvidence | undefined> {
  if (!config.trace.enabled) return undefined;
  const attached = testInfo.attachments.find(attachment =>
    Boolean(attachment.path) && (attachment.name === 'trace' || attachment.path!.endsWith('trace.zip')));
  const fallback = testInfo.outputPath('trace.zip');
  const path = attached?.path ?? fallback;
  try {
    await access(path);
  } catch {
    return undefined;
  }
  const evidence = await readPlaywrightTrace(path, {
    maxEvents: config.trace.maxEvents,
    redact: value => redactSensitiveText(value, config),
  });
  const captured = history
    .map((snapshot, snapshotIndex) => ({ snapshotIndex, capturedAt: snapshot.capturedAt }))
    .filter((entry): entry is { snapshotIndex: number; capturedAt: number } => typeof entry.capturedAt === 'number');
  let correlated = 0;
  for (const action of evidence.actions) {
    if (typeof action.wallTime !== 'number' || captured.length === 0) continue;
    const nearest = captured.reduce((best, entry) =>
      Math.abs(entry.capturedAt - action.wallTime!) < Math.abs(best.capturedAt - action.wallTime!) ? entry : best);
    action.snapshotIndex = nearest.snapshotIndex;
    correlated++;
  }
  if (evidence.actions.length > 0 && correlated === 0) {
    evidence.warnings.push('Trace and DOM snapshot timestamp domains could not be correlated');
  }
  return evidence;
}

function buildTextReport(
  testName: string,
  errorMessage: string,
  history: DomNode[],
  diffs: DiffResult[],
  verdict: Verdict,
  mutationLogs: MutationRecord[][],
  traceEvidence?: TraceEvidence,
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
      const batch = mutationLogs[i] as MutationBatch;
      lines.push(`  Snapshot ${Math.max(0, batch.snapshotIndex - 1)} → ${batch.snapshotIndex}: ${batch.length} mutations${batch.dropped ? ` (${batch.dropped} dropped)` : ''}`);
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

  if (traceEvidence) {
    lines.push('--- PLAYWRIGHT TRACE EVIDENCE ---');
    lines.push(`Actions: ${traceEvidence.actions.length}`);
    lines.push(`Network events: ${traceEvidence.network.length}`);
    lines.push(`Console events: ${traceEvidence.console.length}`);
    for (const warning of traceEvidence.warnings) lines.push(`  Warning: ${warning}`);
    if (traceEvidence.truncated) lines.push('  Warning: trace events truncated by configured limit');
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
