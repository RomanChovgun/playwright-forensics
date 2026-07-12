import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';

export interface TraceAction {
  apiName: string;
  startTime?: number;
  endTime?: number;
  wallTime?: number;
  snapshotIndex?: number;
  selector?: string;
  error?: string;
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

export async function readPlaywrightTrace(path: string, options: TraceReaderOptions): Promise<TraceEvidence> {
  const evidence: TraceEvidence = {
    source: path,
    actions: [],
    network: [],
    console: [],
    warnings: [],
    truncated: false,
  };
  try {
    const archive = unzipSync(new Uint8Array(await readFile(path)));
    const entries = Object.entries(archive)
      .filter(([name]) => /\.(?:trace|network)$/.test(name))
      .flatMap(([, value]) => records(strFromU8(value)));
    for (const event of entries) {
      if (evidence.actions.length + evidence.network.length + evidence.console.length >= options.maxEvents) {
        evidence.truncated = true;
        break;
      }
      const type = string(event.type);
      const metadata = event.metadata && typeof event.metadata === 'object'
        ? event.metadata as Record<string, unknown> : event;
      if (type === 'before' || type === 'after' || metadata.apiName) {
        const apiName = string(metadata.apiName) ?? string(metadata.method);
        if (apiName) evidence.actions.push({
          apiName: options.redact(apiName),
          startTime: number(metadata.startTime),
          endTime: number(metadata.endTime),
          wallTime: number(metadata.wallTime),
          selector: string(metadata.selector) ? options.redact(string(metadata.selector)!) : undefined,
          error: string(metadata.error) ? options.redact(string(metadata.error)!) : undefined,
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
      if (type === 'console' || event.messageType || event.text) {
        const text = string(event.text) ?? string(event.message);
        if (text) evidence.console.push({
          type: string(event.messageType),
          text: options.redact(text),
        });
      }
    }
    if (entries.length === 0) evidence.warnings.push('No supported JSONL trace entries found');
  } catch (error) {
    evidence.warnings.push(`Trace could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return evidence;
}
