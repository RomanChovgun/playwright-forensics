import type { DomNode } from '../collector/dom-snapshot.js';
import type { ForensicsConfig } from '../config.js';
import type { TraceAction, TraceEvidence } from '../trace/trace-reader.js';
import { decodeFrameSnapshots } from '../trace/snapshot-decoder.js';
import { diffDomTrees } from './dom-diff.js';
import type { DiffResult } from './dom-diff.js';
import { parseErrorMessage } from './error-parser.js';
import type { ParsedError } from './error-parser.js';
import { traceSelector } from './selector-tracer.js';
import type { SelectorTrace } from './selector-tracer.js';
import { buildVerdict } from './verdict-builder.js';
import type { Verdict } from './verdict-builder.js';

export interface FailureAnalysis {
  errorMessage: string;
  parsed: ParsedError;
  history: DomNode[];
  diffs: DiffResult[];
  selectorTrace?: SelectorTrace;
  verdict: Verdict;
  failedAction?: TraceAction;
  traceEvidence?: TraceEvidence;
  warnings: string[];
}

function locatorLine(selector: string): string {
  const testId = selector.match(/internal:testid=\[[^=]+=(?:"([^"]+)"|'([^']+)')/i);
  if (testId) return `getByTestId(${JSON.stringify(testId[1] ?? testId[2])})`;
  const text = selector.match(/internal:text=(?:"([^"]+)"|'([^']+)'|([^>]+))/i);
  if (text) return `getByText(${JSON.stringify((text[1] ?? text[2] ?? text[3]).trim())})`;
  const role = selector.match(/internal:role=([a-z]+)/i);
  if (role) return `getByRole(${JSON.stringify(role[1])})`;
  return `locator(${JSON.stringify(selector)})`;
}

function chooseFailedAction(trace?: TraceEvidence): TraceAction | undefined {
  if (!trace) return undefined;
  return [...trace.actions].reverse().find(action => action.error)
    ?? trace.actions.at(-1);
}

export function analyzeFailure(input: {
  errorMessage?: string;
  history?: DomNode[];
  traceEvidence?: TraceEvidence;
  config: ForensicsConfig;
}): FailureAnalysis {
  const failedAction = chooseFailedAction(input.traceEvidence);
  const baseError = input.errorMessage || failedAction?.error || 'No failed action was found in the trace';
  const errorMessage = failedAction?.selector && !/\b(?:getBy|locator|frameLocator)\(/.test(baseError)
    ? `${baseError}\nLocator: ${locatorLine(failedAction.selector)}`
    : baseError;
  const relevantSnapshots = (input.traceEvidence?.frameSnapshots ?? []).filter(snapshot =>
    snapshot.isMainFrame && (!failedAction?.pageId || snapshot.pageId === failedAction.pageId));
  const decoded = relevantSnapshots.length
    ? decodeFrameSnapshots(relevantSnapshots, input.config)
    : { history: [], warnings: [] };
  const history = input.history?.length ? input.history : decoded.history;
  const parsed = parseErrorMessage(errorMessage);
  const diffs = history.length >= 2 ? diffDomTrees(history.at(-2)!, history.at(-1)!) : [];
  const selectorTrace = parsed.locator?.expression && history.length
    ? traceSelector(parsed.locator.expression, history, history.length - 1)
    : undefined;
  const verdict = buildVerdict(parsed, selectorTrace, history, diffs);
  if (failedAction) {
    verdict.evidence.push(`Failed trace action: ${failedAction.apiName}`);
    if (failedAction.source?.file) {
      verdict.evidence.push(
        `Source: ${failedAction.source.file}:${failedAction.source.line ?? '?'}:${failedAction.source.column ?? '?'}`,
      );
    }
  }
  if (!history.length) {
    verdict.limitations = [...(verdict.limitations ?? []), 'No decodable DOM snapshots were available in the trace'];
    if (verdict.confidence === 'confirmed') verdict.confidence = 'likely';
  }
  const warnings = [...decoded.warnings, ...(input.traceEvidence?.warnings ?? [])];
  return {
    errorMessage,
    parsed,
    history,
    diffs,
    selectorTrace,
    verdict,
    failedAction,
    traceEvidence: input.traceEvidence,
    warnings: [...new Set(warnings)],
  };
}
