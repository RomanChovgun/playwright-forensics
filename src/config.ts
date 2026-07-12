import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface ForensicsConfig {
  snapshotCount: number;
  maxNodes: number;
  maxSnapshotBytes: number;
  maxTextLength: number;
  maxMutationRecords: number;
  redaction: RedactionConfig;
  trace: TraceConfig;
  plugins: string[];
}

export interface RedactionConfig {
  enabled: boolean;
  replacement: string;
  attributes: string[];
  textPatterns: string[];
  urlQuery: boolean;
}

export interface TraceConfig {
  enabled: boolean;
  maxEvents: number;
}

export const DEFAULT_CONFIG: Readonly<ForensicsConfig> = Object.freeze({
  snapshotCount: 25,
  maxNodes: 5_000,
  maxSnapshotBytes: 2_000_000,
  maxTextLength: 500,
  maxMutationRecords: 1_000,
  redaction: Object.freeze({
    enabled: true,
    replacement: '[REDACTED]',
    attributes: Object.freeze([
      'authorization', 'cookie', 'set-cookie', 'value',
      'data-token', 'data-secret', 'data-password',
    ]) as unknown as string[],
    textPatterns: Object.freeze([
      String.raw`\bBearer\s+[A-Za-z0-9._~+/-]+=*\b`,
      String.raw`\b(?:token|secret|password|passwd|api[-_]?key)\s*[:=]\s*[^\s,;]+`,
    ]) as unknown as string[],
    urlQuery: true,
  }),
  trace: Object.freeze({ enabled: true, maxEvents: 1_000 }),
  plugins: Object.freeze([]) as unknown as string[],
});

const KNOWN_CONFIG_KEYS = new Set([
  'snapshotCount', 'maxNodes', 'maxSnapshotBytes', 'maxTextLength',
  'maxMutationRecords', 'redaction', 'trace', 'plugins',
]);
const configCache = new Map<string, ForensicsConfig>();

function positiveInteger(value: unknown, fallback: number, key: string, source: string): number {
  if (Number.isInteger(value) && (value as number) > 0) return value as number;
  if (value !== undefined) console.warn(`[forensics] Invalid "${key}" in ${source}; using ${fallback}`);
  return fallback;
}

function parseConfig(config: Record<string, unknown>, source: string): ForensicsConfig {
  for (const key of Object.keys(config)) {
    if (!KNOWN_CONFIG_KEYS.has(key)) {
      console.warn(`[forensics] Unknown config key "${key}" in ${source}`);
    }
  }
  const redaction = typeof config.redaction === 'object' && config.redaction !== null
    ? config.redaction as Record<string, unknown>
    : {};
  const trace = typeof config.trace === 'object' && config.trace !== null
    ? config.trace as Record<string, unknown>
    : {};
  return {
    snapshotCount: positiveInteger(config.snapshotCount, DEFAULT_CONFIG.snapshotCount, 'snapshotCount', source),
    maxNodes: positiveInteger(config.maxNodes, DEFAULT_CONFIG.maxNodes, 'maxNodes', source),
    maxSnapshotBytes: positiveInteger(config.maxSnapshotBytes, DEFAULT_CONFIG.maxSnapshotBytes, 'maxSnapshotBytes', source),
    maxTextLength: positiveInteger(config.maxTextLength, DEFAULT_CONFIG.maxTextLength, 'maxTextLength', source),
    maxMutationRecords: positiveInteger(config.maxMutationRecords, DEFAULT_CONFIG.maxMutationRecords, 'maxMutationRecords', source),
    redaction: {
      enabled: typeof redaction.enabled === 'boolean' ? redaction.enabled : DEFAULT_CONFIG.redaction.enabled,
      replacement: typeof redaction.replacement === 'string' && redaction.replacement
        ? redaction.replacement : DEFAULT_CONFIG.redaction.replacement,
      attributes: Array.isArray(redaction.attributes) && redaction.attributes.every(v => typeof v === 'string')
        ? redaction.attributes.map(v => v.toLowerCase()) : [...DEFAULT_CONFIG.redaction.attributes],
      textPatterns: Array.isArray(redaction.textPatterns) && redaction.textPatterns.every(v => typeof v === 'string')
        ? [...redaction.textPatterns] : [...DEFAULT_CONFIG.redaction.textPatterns],
      urlQuery: typeof redaction.urlQuery === 'boolean' ? redaction.urlQuery : DEFAULT_CONFIG.redaction.urlQuery,
    },
    trace: {
      enabled: typeof trace.enabled === 'boolean' ? trace.enabled : DEFAULT_CONFIG.trace.enabled,
      maxEvents: positiveInteger(trace.maxEvents, DEFAULT_CONFIG.trace.maxEvents, 'trace.maxEvents', source),
    },
    plugins: Array.isArray(config.plugins) && config.plugins.every(v => typeof v === 'string')
      ? [...config.plugins] : [...DEFAULT_CONFIG.plugins],
  };
}

export async function loadConfig(cwd?: string): Promise<ForensicsConfig> {
  const dir = cwd || process.cwd();
  const cached = configCache.get(dir);
  if (cached) return cached;
  const candidates = [
    join(dir, '.forensicsrc'),
    join(dir, '.forensicsrc.json'),
    join(dir, 'forensics.config.json'),
    join(dir, 'package.json'),
  ];

  for (const file of candidates) {
    if (!existsSync(file)) continue;

    try {
      const raw = await readFile(file, 'utf-8');

      if (file.endsWith('package.json')) {
        const pkg = JSON.parse(raw);
        if (pkg.forensics && typeof pkg.forensics === 'object') {
          const result = parseConfig(pkg.forensics, file);
          configCache.set(dir, result);
          return result;
        }
        continue;
      }

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      const result = parseConfig(parsed, file);
      configCache.set(dir, result);
      return result;
    } catch {
      // skip invalid files
    }
  }

  const result = parseConfig({}, '<defaults>');
  configCache.set(dir, result);
  return result;
}

export function resetConfigCache(): void {
  configCache.clear();
}


