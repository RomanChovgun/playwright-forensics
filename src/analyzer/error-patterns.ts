import type { FailureType } from './error-parser.js';

export interface ErrorPattern {
  name: string;
  test: (error: string) => boolean;
  failureType: FailureType;
}

/**
 * Pattern order is CRITICAL. More specific patterns MUST come before general ones.
 * Examples:
 *   - "wait-visible-enabled-stable" before "wait-visible" (the latter also matches the former)
 *   - "not-enabled" before "wait-enabled" (same reason)
 *   - "assertion-attribute-mismatch" before "assertion-other" (attribute checks are more specific)
 */
const patterns: ErrorPattern[] = [
  {
    name: 'network-error',
    test: (e) => /net::(ERR_\w+)/.test(e),
    failureType: 'network-error',
  },
  {
    name: 'execution-context-destroyed',
    test: (e) => /Execution context was destroyed/.test(e),
    failureType: 'execution-context-destroyed',
  },
  {
    name: 'target-closed',
    test: (e) => /Target (page|context|browser).*has been closed|Target closed/.test(e),
    failureType: 'target-closed',
  },
  {
    name: 'page-crash',
    test: (e) => /page (crashed|crash)/i.test(e),
    failureType: 'page-crash',
  },
  {
    name: 'frame-detached',
    test: (e) => /Frame was detached/.test(e),
    failureType: 'frame-detached',
  },
  {
    name: 'strict-mode-violation',
    test: (e) => /strict mode violation/.test(e) || /resolved to \d+ elements/.test(e),
    failureType: 'strict-mode-violation',
  },
  {
    name: 'locator-timeout-no-elements',
    test: (e) => /element\(s\) not found/.test(e),
    failureType: 'locator-timeout',
  },
  {
    name: 'not-enabled',
    test: (e) => /element is not enabled/.test(e),
    failureType: 'not-enabled',
  },
  {
    name: 'not-stable',
    test: (e) => /element is not stable/.test(e),
    failureType: 'not-stable',
  },
  {
    name: 'not-visible',
    test: (e) => /element is not visible/.test(e),
    failureType: 'not-visible',
  },
  {
    name: 'obscured',
    test: (e) => /intercepts pointer events|element is not receiving events/.test(e),
    failureType: 'obscured',
  },
  {
    name: 'not-checkbox',
    test: (e) => /Not a checkbox or radio button|Element is not a checkbox or radio button/.test(e),
    failureType: 'not-checkbox',
  },
  {
    name: 'not-editable',
    test: (e) => /Element is not an <input>|Element is not .* contenteditable/.test(e),
    failureType: 'not-editable',
  },
  {
    name: 'not-focusable',
    test: (e) => /Element is not focusable/.test(e),
    failureType: 'not-focusable',
  },
  {
    name: 'detached',
    test: (e) => /Target detached from DOM/.test(e),
    failureType: 'detached',
  },
  {
    name: 'wait-visible-enabled-stable',
    test: (e) => /waiting for element to be visible, enabled and stable/.test(e),
    failureType: 'locator-timeout',
  },
  {
    name: 'wait-visible',
    test: (e) => /waiting for element to be visible/.test(e),
    failureType: 'not-visible',
  },
  {
    name: 'wait-enabled',
    test: (e) => /waiting for element to be enabled/.test(e),
    failureType: 'not-enabled',
  },
  {
    name: 'navigation-timeout',
    test: (e) => /Timeout.*exceeded/.test(e) && /goto|navigating/.test(e),
    failureType: 'navigation-timeout',
  },
  {
    name: 'assertion-text-mismatch',
    test: (e) => /expect.*\.toHaveText\(\)/.test(e),
    failureType: 'assertion-text-mismatch',
  },
  {
    name: 'assertion-count-mismatch',
    test: (e) => /expect.*\.toHaveCount\(/.test(e),
    failureType: 'assertion-count-mismatch',
  },
  {
    name: 'assertion-visibility',
    test: (e) => /expect.*\.(toBeVisible|toBeHidden|toBeAttached)\(\)/.test(e),
    failureType: 'assertion-visibility',
  },
  {
    name: 'assertion-url-mismatch',
    test: (e) => /expect.*\.(toHaveURL|toHaveTitle)\(/.test(e),
    failureType: 'assertion-url-mismatch',
  },
  {
    name: 'assertion-screenshot',
    test: (e) => /expect.*\.toHaveScreenshot|Snapshot comparison/.test(e),
    failureType: 'assertion-screenshot',
  },
  {
    name: 'assertion-api-response',
    test: (e) => /expect.*\.toBeOK/.test(e),
    failureType: 'assertion-api-response',
  },
  {
    name: 'assertion-attribute-mismatch',
    test: (e) => /expect.*\.(toHaveAttribute|toHaveClass|toHaveCSS|toHaveValue|toHaveId|toHaveJSProperty|toHaveAccessibleName|toHaveAccessibleDescription|toHaveRole)\(/.test(e),
    failureType: 'assertion-attribute-mismatch',
  },
  {
    name: 'assertion-other',
    test: (e) => /expect.*\.(toBeChecked|toBeDisabled|toBeEnabled|toBeFocused|toBeEditable|toBeEmpty|toBeInViewport|toBePartiallyChecked)/.test(e),
    failureType: 'assertion-other',
  },
  {
    name: 'generic-timeout',
    test: (e) => /Timeout.*exceeded/.test(e),
    failureType: 'locator-timeout',
  },
];

export function matchPattern(error: string): ErrorPattern | undefined {
  for (const p of patterns) {
    if (p.test(error)) return p;
  }
  return undefined;
}
