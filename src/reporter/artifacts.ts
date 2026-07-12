import { mkdir, writeFile } from 'node:fs/promises';
import { EOL } from 'node:os';
import { join } from 'node:path';
import type { FailureAnalysis } from '../analyzer/analysis-pipeline.js';
import type { DomNode } from '../collector/dom-snapshot.js';
import type { MutationBatch } from '../collector/mutation-log.js';
import type { TraceEvidence } from '../trace/trace-reader.js';
import { renderVerdictText } from '../analyzer/verdict-builder.js';
import { generateHtmlReport } from './html-report.js';

export interface ReportArtifactPaths {
  html: string;
  text: string;
  json: string;
}

export function traceEvidenceForReport(trace?: TraceEvidence): Omit<TraceEvidence, 'frameSnapshots'> | undefined {
  if (!trace) return undefined;
  const safe = { ...trace } as Partial<TraceEvidence>;
  delete safe.frameSnapshots;
  return safe as Omit<TraceEvidence, 'frameSnapshots'>;
}

export function renderTextReport(
  testName: string,
  analysis: FailureAnalysis,
  mutationLogs: MutationBatch[] = [],
): string {
  const lines = [
    '=== PLAYWRIGHT FORENSICS REPORT ===',
    `Test: ${testName}`,
    `Error: ${analysis.errorMessage}`,
    `DOM snapshots: ${analysis.history.length}`,
    '',
    '--- CAUSAL ANALYSIS ---',
    renderVerdictText(analysis.verdict),
    '',
  ];
  if (analysis.failedAction) {
    lines.push('--- FAILED TRACE ACTION ---');
    lines.push(`  ${analysis.failedAction.apiName}`);
    if (analysis.failedAction.selector) lines.push(`  Selector: ${analysis.failedAction.selector}`);
    if (analysis.failedAction.source?.file) {
      lines.push(`  Source: ${analysis.failedAction.source.file}:${analysis.failedAction.source.line ?? '?'}:${analysis.failedAction.source.column ?? '?'}`);
    }
    lines.push('');
  }
  if (analysis.traceEvidence) {
    lines.push('--- PLAYWRIGHT TRACE EVIDENCE ---');
    lines.push(`Actions: ${analysis.traceEvidence.actions.length}`);
    lines.push(`DOM snapshots: ${analysis.traceEvidence.frameSnapshots.length}`);
    lines.push(`Network events: ${analysis.traceEvidence.network.length}`);
    lines.push(`Console events: ${analysis.traceEvidence.console.length}`);
    lines.push('');
  }
  if (mutationLogs.length) {
    lines.push('--- MUTATION LOG ---');
    for (const batch of mutationLogs) {
      lines.push(`  Snapshot ${Math.max(0, batch.snapshotIndex - 1)} → ${batch.snapshotIndex}: ${batch.length} mutations${batch.dropped ? ` (${batch.dropped} dropped)` : ''}`);
    }
    lines.push('');
  }
  if (analysis.diffs.length) {
    lines.push('--- DOM DIFF (last 2 snapshots) ---');
    for (const diff of analysis.diffs) {
      lines.push(`  [${diff.type}] ${diff.path}`);
      if (diff.oldValue) lines.push(`    was: ${diff.oldValue}`);
      if (diff.newValue) lines.push(`    now: ${diff.newValue}`);
    }
    lines.push('');
  }
  if (analysis.warnings.length) {
    lines.push('--- LIMITATIONS ---', ...analysis.warnings.map(warning => `  ${warning}`), '');
  }
  return lines.join(EOL);
}

export async function writeFailureReports(input: {
  outputDir: string;
  testName: string;
  analysis: FailureAnalysis;
  snapshotLimit: number;
  mutationLogs?: MutationBatch[];
}): Promise<ReportArtifactPaths> {
  await mkdir(input.outputDir, { recursive: true });
  const history: DomNode[] = input.analysis.history.length
    ? input.analysis.history
    : [{ tag: '#document', attributes: {}, children: [], visible: false }];
  const text = renderTextReport(input.testName, input.analysis, input.mutationLogs);
  const html = generateHtmlReport({
    testName: input.testName,
    errorMessage: input.analysis.errorMessage,
    history,
    diffs: input.analysis.diffs,
    trace: input.analysis.selectorTrace,
    verdict: input.analysis.verdict,
    mutationLogs: input.mutationLogs,
    traceEvidence: input.analysis.traceEvidence,
    snapshotLimit: input.snapshotLimit,
  });
  const paths = {
    html: join(input.outputDir, 'forensics-report.html'),
    text: join(input.outputDir, 'forensics-report.txt'),
    json: join(input.outputDir, 'forensics-report.json'),
  };
  await Promise.all([
    writeFile(paths.html, html, 'utf8'),
    writeFile(paths.text, text, 'utf8'),
    writeFile(paths.json, JSON.stringify({
      schemaVersion: 2,
      testName: input.testName,
      errorMessage: input.analysis.errorMessage,
      verdict: input.analysis.verdict,
      failedAction: input.analysis.failedAction,
      diffs: input.analysis.diffs,
      warnings: input.analysis.warnings,
      trace: traceEvidenceForReport(input.analysis.traceEvidence),
      snapshots: input.analysis.history,
      mutationLogs: input.mutationLogs ?? [],
    }, null, 2), 'utf8'),
  ]);
  return paths;
}
