import { existsSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { analyzeFailure } from '../analyzer/analysis-pipeline.js';
import { loadConfig } from '../config.js';
import { writeFailureReports } from '../reporter/artifacts.js';
import type { ReportArtifactPaths } from '../reporter/artifacts.js';
import { readPlaywrightTrace } from './trace-reader.js';
import type { FailureAnalysis } from '../analyzer/analysis-pipeline.js';

export interface AnalyzeTraceFileResult {
  tracePath: string;
  outputDir: string;
  analysis: FailureAnalysis;
  paths: ReportArtifactPaths;
}

export async function analyzeTraceFile(
  path: string,
  options: { outputDir?: string; configCwd?: string } = {},
): Promise<AnalyzeTraceFileResult> {
  const tracePath = resolve(path);
  if (!existsSync(tracePath) || extname(tracePath).toLowerCase() !== '.zip') {
    throw new Error(`Trace zip not found: ${tracePath}`);
  }
  const defaultName = `${basename(tracePath, extname(tracePath))}-forensics`;
  const outputDir = resolve(options.outputDir ?? join(dirname(tracePath), defaultName));
  const config = await loadConfig(options.configCwd);
  const redact = (value: string): string => {
    if (!config.redaction.enabled) return value;
    let safe = value;
    if (config.redaction.urlQuery) {
      safe = safe.replace(/(https?:\/\/[^\s?#]+)\?[^\s#]*/gi, `$1?${config.redaction.replacement}`);
    }
    for (const pattern of config.redaction.textPatterns) {
      try { safe = safe.replace(new RegExp(pattern, 'gi'), config.redaction.replacement); } catch { /* invalid user pattern */ }
    }
    return safe;
  };
  const traceEvidence = await readPlaywrightTrace(tracePath, {
    maxEvents: config.trace.maxEvents,
    redact,
  });
  if (
    traceEvidence.actions.length === 0
    && traceEvidence.frameSnapshots.length === 0
    && traceEvidence.network.length === 0
    && traceEvidence.console.length === 0
    && traceEvidence.warnings.some(warning => warning.startsWith('Trace could not be parsed:'))
  ) {
    throw new Error(traceEvidence.warnings[0]);
  }
  const analysis = analyzeFailure({ traceEvidence, config });
  const testName = analysis.failedAction?.title
    ?? analysis.failedAction?.apiName
    ?? basename(tracePath);
  const paths = await writeFailureReports({
    outputDir,
    testName,
    analysis,
    snapshotLimit: config.snapshotCount,
  });
  return { tracePath, outputDir, analysis, paths };
}
