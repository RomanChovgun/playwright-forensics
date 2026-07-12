import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { Verdict } from './analyzer/verdict-builder.js';
import type { ParsedError } from './analyzer/error-parser.js';
import type { DomNode } from './collector/dom-snapshot.js';
import type { SelectorTrace } from './analyzer/selector-tracer.js';
import type { DiffResult } from './analyzer/dom-diff.js';
import type { TraceEvidence } from './trace/trace-reader.js';

let _require: ReturnType<typeof createRequire> | null = null;

function getRequire(): ReturnType<typeof createRequire> {
  if (!_require) {
    _require = createRequire(import.meta.url);
  }
  return _require;
}

export interface PluginContext {
  testName: string;
  errorMessage: string;
  history: DomNode[];
  diffs: DiffResult[];
  trace?: SelectorTrace;
  mutationLogCount: number;
  networkErrorCode?: string;
  traceEvidence?: TraceEvidence;
}

export interface ForensicsPlugin {
  name: string;
  onVerdict?: (verdict: Verdict, parsed: ParsedError, context: PluginContext) => Verdict;
  onReport?: (report: { text: string; html: string }, context: PluginContext) => { text: string; html: string };
}

const pluginRegistry: Map<string, ForensicsPlugin> = new Map();

export function registerPlugin(plugin: ForensicsPlugin): void {
  if (pluginRegistry.has(plugin.name)) {
    console.warn(`[forensics] Plugin "${plugin.name}" is already registered — overwriting`);
  }
  pluginRegistry.set(plugin.name, plugin);
}

export function getPlugin(name: string): ForensicsPlugin | undefined {
  return pluginRegistry.get(name);
}

function resolvePluginPath(name: string): string {
  const fullPath = resolve(name);
  if (existsSync(fullPath) || existsSync(fullPath + '.js') || existsSync(fullPath + '.mjs')) {
    return fullPath;
  }
  return name;
}

export async function loadPlugins(pluginNames: string[]): Promise<ForensicsPlugin[]> {
  const loaded: ForensicsPlugin[] = [];
  for (const name of pluginNames) {
    try {
      const resolved = resolvePluginPath(name);
      let mod: Record<string, unknown>;

      try {
        mod = getRequire()(resolved) as Record<string, unknown>;
      } catch {
        mod = await import(resolved) as Record<string, unknown>;
      }

      const plugin = (mod.default ?? mod) as ForensicsPlugin;
      if (plugin && typeof plugin.name === 'string') {
        if (pluginRegistry.has(plugin.name)) {
          console.warn(`[forensics] Plugin "${plugin.name}" from "${name}" is already registered — skipping`);
          continue;
        }
        registerPlugin(plugin);
        loaded.push(plugin);
      }
    } catch (e) {
      console.error(`[forensics] Failed to load plugin "${name}":`, e);
    }
  }
  return loaded;
}

export function runVerdictPlugins(
  plugins: ForensicsPlugin[],
  verdict: Verdict,
  parsed: ParsedError,
  context: PluginContext,
): Verdict {
  let result = verdict;
  for (const plugin of plugins) {
    if (plugin.onVerdict) {
      result = plugin.onVerdict(result, parsed, context);
    }
  }
  return result;
}

export function runReportPlugins(
  plugins: ForensicsPlugin[],
  text: string,
  html: string,
  context: PluginContext,
): { text: string; html: string } {
  let result = { text, html };
  for (const plugin of plugins) {
    if (plugin.onReport) {
      result = plugin.onReport(result, context);
    }
  }
  return result;
}
