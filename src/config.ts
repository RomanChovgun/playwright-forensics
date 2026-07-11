import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface ForensicsConfig {
  snapshotCount?: number;
  plugins?: string[];
}

const DEFAULT_CONFIG: ForensicsConfig = {};

const KNOWN_CONFIG_KEYS = new Set(['snapshotCount', 'plugins']);

let cachedConfig: ForensicsConfig | null = null;

function validateConfig(config: Record<string, unknown>, source: string): void {
  for (const key of Object.keys(config)) {
    if (!KNOWN_CONFIG_KEYS.has(key)) {
      console.warn(`[forensics] Unknown config key "${key}" in ${source}`);
    }
  }
}

export async function loadConfig(cwd?: string): Promise<ForensicsConfig> {
  if (cachedConfig) return cachedConfig;
  const dir = cwd || process.cwd();
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
          validateConfig(pkg.forensics, file);
          cachedConfig = { ...DEFAULT_CONFIG, ...pkg.forensics };
          return cachedConfig!;
        }
        continue;
      }

      const parsed = JSON.parse(raw);
      validateConfig(parsed, file);
      cachedConfig = { ...DEFAULT_CONFIG, ...parsed };
      return cachedConfig!;
    } catch {
      // skip invalid files
    }
  }

  cachedConfig = DEFAULT_CONFIG;
  return cachedConfig!;
}

export function resetConfigCache(): void {
  cachedConfig = null;
}


