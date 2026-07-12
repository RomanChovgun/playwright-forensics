import { matchPattern } from './error-patterns.js';
import { parseLocatorExpression } from './locator/parser.js';
import type { LocatorExpression, LocatorStep } from './locator/types.js';

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
  expression?: LocatorExpression;
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
  const expression = parseLocatorExpression(error);
  if (!expression) return undefined;
  const parts = expression.steps.map(displayStep).filter((part): part is { type: string; value: string } => Boolean(part));
  if (parts.length === 0) return undefined;
  return {
    type: parts[0].type,
    value: parts[0].value,
    chain: parts.length > 1 ? parts.slice(1) : undefined,
    expression,
  };
}

function displayStep(step: LocatorStep): { type: string; value: string } | undefined {
  if ('matcher' in step) return {
    type: `getBy${step.kind === 'testId' ? 'TestId' : step.kind[0].toUpperCase() + step.kind.slice(1)}`,
    value: step.matcher.value,
  };
  if (step.kind === 'role') return { type: 'getByRole', value: step.role };
  if (step.kind === 'css' || step.kind === 'xpath') return { type: 'locator', value: step.value };
  if (step.kind === 'nth') return { type: 'nth', value: String(step.index) };
  if (step.kind === 'first' || step.kind === 'last') return { type: step.kind, value: '' };
  if (step.kind === 'frame') return { type: 'frameLocator', value: step.value };
  return undefined;
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
