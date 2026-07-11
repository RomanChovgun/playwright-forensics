import { matchPattern } from './error-patterns.js';

export type FailureType =
  | 'locator-timeout'
  | 'strict-mode-violation'
  | 'not-visible'
  | 'not-stable'
  | 'not-enabled'
  | 'obscured'
  | 'not-editable'
  | 'not-focusable'
  | 'not-checkbox'
  | 'detached'
  | 'target-closed'
  | 'frame-detached'
  | 'execution-context-destroyed'
  | 'network-error'
  | 'navigation-timeout'
  | 'page-crash'
  | 'assertion-text-mismatch'
  | 'assertion-count-mismatch'
  | 'assertion-attribute-mismatch'
  | 'assertion-visibility'
  | 'assertion-url-mismatch'
  | 'assertion-screenshot'
  | 'assertion-api-response'
  | 'assertion-other'
  | 'unknown';

export interface ParsedLocator {
  type: string;
  value: string;
  chain?: { type: string; value: string }[];
}

export interface ParsedError {
  failureType: FailureType;
  locator?: ParsedLocator;
  timeoutMs?: number;
  networkErrorCode?: string;
  expectedValue?: string;
  actualValue?: string;
  strictCount?: number;
  rawMessage: string;
}

const LOCATOR_PATTERNS = [
  { pattern: /getByTestId\(\s*['"]([^'"]+)['"]\s*\)/g, type: 'getByTestId' },
  { pattern: /getByText\(\s*['"]([^'"]+)['"]\s*\)/g, type: 'getByText' },
  { pattern: /getByRole\(\s*['"]([^'"]+)['"]\s*(?:,\s*\{[^}]*\})?\s*\)/g, type: 'getByRole' },
  { pattern: /getByLabel\(\s*['"]([^'"]+)['"]\s*\)/g, type: 'getByLabel' },
  { pattern: /getByPlaceholder\(\s*['"]([^'"]+)['"]\s*\)/g, type: 'getByPlaceholder' },
  { pattern: /getByAltText\(\s*['"]([^'"]+)['"]\s*\)/g, type: 'getByAltText' },
  { pattern: /getByTitle\(\s*['"]([^'"]+)['"]\s*\)/g, type: 'getByTitle' },
  { pattern: /locator\(\s*['"]([^'"]+)['"]\s*\)/g, type: 'locator' },
];

export function parseErrorMessage(error: string): ParsedError {
  const networkMatch = error.match(/net::(ERR_\w+)/);
  const networkErrorCode = networkMatch ? networkMatch[1] : undefined;
  const matched = matchPattern(error);
  const failureType = matched?.failureType ?? 'unknown';
  const strictCount = failureType === 'strict-mode-violation' ? extractStrictCount(error) : undefined;

  return {
    failureType,
    strictCount,
    timeoutMs: extractTimeout(error),
    networkErrorCode,
    expectedValue: extractExpectedValue(error, failureType),
    actualValue: extractActualValue(error, failureType),
    locator: extractLocator(error),
    rawMessage: error,
  };
}

function extractLocator(error: string): ParsedLocator | undefined {
  const seen = new Set<string>();
  const parts: { type: string; value: string }[] = [];

  for (const { pattern, type } of LOCATOR_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(error)) !== null) {
      const key = `${type}:${match[1]}`;
      if (!seen.has(key)) {
        seen.add(key);
        parts.push({ type, value: match[1] });
      }
    }
  }

  if (parts.length === 0) {
    const simpleMatch = error.match(/Locator:\s*(.+)/);
    if (simpleMatch) {
      const locText = simpleMatch[1].trim();
      for (const { pattern, type } of LOCATOR_PATTERNS) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(locText)) !== null) {
          const key = `${type}:${match[1]}`;
          if (!seen.has(key)) {
            seen.add(key);
            parts.push({ type, value: match[1] });
          }
        }
      }
    }
  }

  if (parts.length === 0) return undefined;

  const result: ParsedLocator = { type: parts[0].type, value: parts[0].value };
  if (parts.length > 1) {
    result.chain = parts.slice(1);
  }
  return result;
}

function extractTimeout(error: string): number | undefined {
  const match = error.match(/Timeout (\d+)/);
  return match ? parseInt(match[1], 10) : undefined;
}

function extractStrictCount(error: string): number | undefined {
  const match = error.match(/resolved to (\d+) elements/);
  return match ? parseInt(match[1], 10) : undefined;
}

function extractExpectedValue(error: string, failureType: FailureType): string | undefined {
  if (failureType === 'assertion-count-mismatch') {
    const match = error.match(/Expected:\s*(\d+)/);
    return match ? match[1] : undefined;
  }
  const match = error.match(/Expected (?:pattern|string|value)?:?\s*["']([^"']+)["']/);
  if (match) return match[1];
  const simpleMatch = error.match(/Expected:\s*["']([^"']+)["']/);
  return simpleMatch ? simpleMatch[1] : undefined;
}

function extractActualValue(error: string, failureType: FailureType): string | undefined {
  if (failureType === 'assertion-count-mismatch') {
    const match = error.match(/Received:\s*(\d+)/);
    return match ? match[1] : undefined;
  }
  if (failureType === 'assertion-api-response') {
    const match = error.match(/received (\d+)/);
    return match ? match[1] : undefined;
  }
  const match = error.match(/Received:\s*["']([^"']+)["']/);
  if (match) return match[1];
  const simpleMatch = error.match(/Received:\s*([^\n]+)/);
  return simpleMatch ? simpleMatch[1].trim() : undefined;
}
