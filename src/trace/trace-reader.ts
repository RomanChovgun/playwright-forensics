import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import type { RawFrameSnapshot } from './snapshot-decoder.js';

export interface TraceSourceLocation {
  file?: string;
  line?: number;
  column?: number;
}

export interface TraceAction {
  callId?: string;
  pageId?: string;
  apiName: string;
  className?: string;
  method?: string;
  title?: string;
  startTime?: number;
  endTime?: number;
  wallTime?: number;
  snapshotIndex?: number;
  beforeSnapshot?: string;
  afterSnapshot?: string;
  selector?: string;
  error?: string;
  source?: TraceSourceLocation;
}

export interface TraceNetworkEvent {
  method?: string;
  url: string;
  status?: number;
  failure?: string;
}

export interface TraceConsoleEvent {
  type?: string;
  text: string;
}

export interface TraceEvidence {
  source: string;
  actions: TraceAction[];
  network: TraceNetworkEvent[];
  console: TraceConsoleEvent[];
  warnings: string[];
  truncated: boolean;
  traceVersion?: number;
  frameSnapshots: RawFrameSnapshot[];
}

export interface TraceReaderOptions {
  maxEvents: number;
  redact: (value: string) => string;
}

function records(text: string): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line);
      if (value && typeof value === 'object') result.push(value);
    } catch {
      // Playwright trace entries are JSONL; tolerate unknown future records.
    }
  }
  return result;
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function errorMessage(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  const error = object(value);
  return string(error?.message) ?? string(object(error?.error)?.message);
}

function sourceLocation(value: unknown, redact: (value: string) => string): TraceSourceLocation | undefined {
  const frames = Array.isArray(value) ? value : [];
  const frame = object(frames[0]);
  if (!frame) return undefined;
  return {
    file: string(frame.file) ? redact(string(frame.file)!) : undefined,
    line: number(frame.line),
    column: number(frame.column),
  };
}

function selectorFrom(params: Record<string, unknown> | undefined): string | undefined {
  if (!params) return undefined;
  return string(params.selector)
    ?? string(params.locator)
    ?? string(object(params.options)?.selector);
}

export async function readPlaywrightTrace(path: string, options: TraceReaderOptions): Promise<TraceEvidence> {
  const evidence: TraceEvidence = {
    source: path,
    actions: [],
    network: [],
    console: [],
    warnings: [],
    truncated: false,
    frameSnapshots: [],
  };
  try {
    const archive = unzipSync(new Uint8Array(await readFile(path)));
    const entries = Object.entries(archive)
      .filter(([name]) => /\.(?:trace|network)$/.test(name))
      .flatMap(([, value]) => records(strFromU8(value)));
    const actions = new Map<string, TraceAction>();
    let generatedCallId = 0;
    let processedEvents = 0;
    for (const event of entries) {
      if (processedEvents++ >= options.maxEvents) {
        evidence.truncated = true;
        break;
      }
      const type = string(event.type);
      if (type === 'context-options') evidence.traceVersion = number(event.version);
      if (type === 'frame-snapshot') {
        const snapshot = object(event.snapshot);
        if (snapshot?.html && string(snapshot.callId) && string(snapshot.pageId) && string(snapshot.frameId)) {
          evidence.frameSnapshots.push(snapshot as unknown as RawFrameSnapshot);
        }
        continue;
      }

      const metadata = object(event.metadata);
      if (type === 'before') {
        const callId = string(event.callId) ?? `generated-${generatedCallId++}`;
        const className = string(event.class);
        const method = string(event.method);
        const params = object(event.params);
        const action: TraceAction = {
          callId,
          pageId: string(event.pageId),
          className,
          method,
          title: string(event.title),
          apiName: options.redact(string(event.title) ?? ([className, method].filter(Boolean).join('.') || 'unknown action')),
          startTime: number(event.startTime),
          wallTime: number(event.wallTime),
          beforeSnapshot: string(event.beforeSnapshot),
          selector: selectorFrom(params) ? options.redact(selectorFrom(params)!) : undefined,
          source: sourceLocation(event.stack, options.redact),
        };
        actions.set(callId, action);
      } else if (type === 'after') {
        const callId = string(event.callId) ?? `generated-${generatedCallId++}`;
        const action = actions.get(callId) ?? { callId, apiName: 'unknown action' };
        action.endTime = number(event.endTime);
        action.afterSnapshot = string(event.afterSnapshot);
        const message = errorMessage(event.error);
        if (message) action.error = options.redact(message);
        actions.set(callId, action);
      } else if (type === 'action' && metadata) {
        const callId = string(metadata.id) ?? string(event.callId) ?? `generated-${generatedCallId++}`;
        const className = string(metadata.type) ?? string(metadata.class);
        const method = string(metadata.method);
        const params = object(metadata.params);
        actions.set(callId, {
          callId,
          pageId: string(metadata.pageId),
          className,
          method,
          apiName: options.redact(string(metadata.apiName) ?? ([className, method].filter(Boolean).join('.') || 'unknown action')),
          startTime: number(metadata.startTime),
          endTime: number(metadata.endTime),
          wallTime: number(metadata.wallTime),
          selector: selectorFrom(params) ? options.redact(selectorFrom(params)!) : undefined,
          error: errorMessage(metadata.error) ? options.redact(errorMessage(metadata.error)!) : undefined,
          source: sourceLocation(metadata.stack, options.redact),
        });
      }
      const snapshot = event.snapshot && typeof event.snapshot === 'object'
        ? event.snapshot as Record<string, unknown> : event;
      const request = snapshot.request && typeof snapshot.request === 'object'
        ? snapshot.request as Record<string, unknown> : undefined;
      const response = snapshot.response && typeof snapshot.response === 'object'
        ? snapshot.response as Record<string, unknown> : undefined;
      const url = string(request?.url) ?? string(snapshot.url);
      if (url) evidence.network.push({
        method: string(request?.method) ?? string(snapshot.method),
        url: options.redact(url),
        status: number(response?.status) ?? number(snapshot.status),
        failure: string(snapshot.failureText) ? options.redact(string(snapshot.failureText)!) : undefined,
      });
      if (type === 'console') {
        const text = string(event.text) ?? string(event.message);
        if (text) evidence.console.push({
          type: string(event.messageType),
          text: options.redact(text),
        });
      }
    }
    evidence.actions = [...actions.values()].sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));
    evidence.frameSnapshots.sort((a, b) => a.timestamp - b.timestamp);
    if (entries.length === 0) evidence.warnings.push('No supported JSONL trace entries found');
    if (evidence.traceVersion !== undefined && (evidence.traceVersion < 3 || evidence.traceVersion > 8)) {
      evidence.warnings.push(`Trace version ${evidence.traceVersion} is outside the tested compatibility range 3-8`);
    }
  } catch (error) {
    evidence.warnings.push(`Trace could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return evidence;
}
