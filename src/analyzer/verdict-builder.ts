import type { DomNode } from '../collector/dom-snapshot.js';
import type { SelectorTrace } from './selector-tracer.js';
import type { DiffResult } from './dom-diff.js';
import type { ParsedError, FailureType } from './error-parser.js';
import { escapeHtml } from '../escape.js';

export interface Verdict {
  failureType: FailureType;
  icon: string;
  label: string;
  category: 'locator-not-found' | 'dom-disappeared' | 'actionability' | 'network' | 'assertion' | 'runtime' | 'unknown';
  explanation: string;
  recommendation: string;
  details?: string[];
}

const VERDICT_TEMPLATES: Record<FailureType, Omit<Verdict, 'explanation' | 'recommendation' | 'details'>> = {
  'locator-timeout': {
    failureType: 'locator-timeout',
    icon: '⏱️',
    label: 'Locator Timeout',
    category: 'locator-not-found',
  },
  'strict-mode-violation': {
    failureType: 'strict-mode-violation',
    icon: '🔀',
    label: 'Strict Mode Violation',
    category: 'locator-not-found',
  },
  'not-visible': {
    failureType: 'not-visible',
    icon: '👻',
    label: 'Element Not Visible',
    category: 'actionability',
  },
  'not-stable': {
    failureType: 'not-stable',
    icon: '🎬',
    label: 'Element Not Stable',
    category: 'actionability',
  },
  'not-enabled': {
    failureType: 'not-enabled',
    icon: '🔒',
    label: 'Element Disabled',
    category: 'actionability',
  },
  'obscured': {
    failureType: 'obscured',
    icon: '🪟',
    label: 'Element Obscured',
    category: 'actionability',
  },
  'not-editable': {
    failureType: 'not-editable',
    icon: '✏️',
    label: 'Element Not Editable',
    category: 'actionability',
  },
  'not-focusable': {
    failureType: 'not-focusable',
    icon: '🎯',
    label: 'Element Not Focusable',
    category: 'actionability',
  },
  'not-checkbox': {
    failureType: 'not-checkbox',
    icon: '☑️',
    label: 'Wrong Element Type',
    category: 'actionability',
  },
  'detached': {
    failureType: 'detached',
    icon: '💥',
    label: 'Element Detached Mid-Action',
    category: 'dom-disappeared',
  },
  'target-closed': {
    failureType: 'target-closed',
    icon: '🚪',
    label: 'Target Closed',
    category: 'runtime',
  },
  'frame-detached': {
    failureType: 'frame-detached',
    icon: '🖼️',
    label: 'Frame Detached',
    category: 'dom-disappeared',
  },
  'execution-context-destroyed': {
    failureType: 'execution-context-destroyed',
    icon: '💀',
    label: 'Page Crashed',
    category: 'runtime',
  },
  'network-error': {
    failureType: 'network-error',
    icon: '🌐',
    label: 'Network Error',
    category: 'network',
  },
  'navigation-timeout': {
    failureType: 'navigation-timeout',
    icon: '🧭',
    label: 'Navigation Timeout',
    category: 'network',
  },
  'page-crash': {
    failureType: 'page-crash',
    icon: '💥',
    label: 'Page Crash',
    category: 'runtime',
  },
  'assertion-text-mismatch': {
    failureType: 'assertion-text-mismatch',
    icon: '📝',
    label: 'Text Assertion Failed',
    category: 'assertion',
  },
  'assertion-count-mismatch': {
    failureType: 'assertion-count-mismatch',
    icon: '🔢',
    label: 'Element Count Assertion Failed',
    category: 'assertion',
  },
  'assertion-attribute-mismatch': {
    failureType: 'assertion-attribute-mismatch',
    icon: '🏷️',
    label: 'Attribute Assertion Failed',
    category: 'assertion',
  },
  'assertion-visibility': {
    failureType: 'assertion-visibility',
    icon: '👁️',
    label: 'Visibility Assertion Failed',
    category: 'assertion',
  },
  'assertion-url-mismatch': {
    failureType: 'assertion-url-mismatch',
    icon: '🔗',
    label: 'URL/Title Assertion Failed',
    category: 'assertion',
  },
  'assertion-screenshot': {
    failureType: 'assertion-screenshot',
    icon: '📸',
    label: 'Screenshot Assertion Failed',
    category: 'assertion',
  },
  'assertion-api-response': {
    failureType: 'assertion-api-response',
    icon: '📡',
    label: 'API Response Assertion Failed',
    category: 'assertion',
  },
  'assertion-other': {
    failureType: 'assertion-other',
    icon: '❓',
    label: 'Assertion Failed',
    category: 'assertion',
  },
  'unknown': {
    failureType: 'unknown',
    icon: '❓',
    label: 'Unknown Error',
    category: 'unknown',
  },
};

function sel(parsed: ParsedError): string {
  const l = parsed.locator;
  if (!l) return '';
  let s = `${l.type}('${l.value}')`;
  if (l.chain) {
    for (const c of l.chain) {
      s += `.${c.type}('${c.value}')`;
    }
  }
  return s;
}

export function buildVerdict(
  parsed: ParsedError,
  trace?: SelectorTrace,
  history?: DomNode[],
  _diffs?: DiffResult[],
): Verdict {
  const tmpl = VERDICT_TEMPLATES[parsed.failureType];
  const selector = sel(parsed);

  const base: Verdict = {
    ...tmpl,
    explanation: '',
    recommendation: '',
  };

  let details: string[] = [];

  switch (parsed.failureType) {
    case 'locator-timeout': {
      if (trace?.found && trace.lastKnownState) {
        const isLastStep = trace.stepFound === (history?.length ?? 0) - 1;
        if (isLastStep) {
          base.explanation = `Selector "${selector}" exists in the DOM but failed actionability checks within ${parsed.timeoutMs ?? 'the'} timeout.`;
          details.push('Element found in DOM at the failure point');
          details.push('It may be hidden, obscured, or not yet loaded');
        } else {
          base.explanation = `Selector "${selector}" stopped existing in the DOM at step ${trace.stepFound}.`;
          if (trace.disappearanceChanges?.length) {
            details.push(...trace.disappearanceChanges);
          }
          base.category = 'dom-disappeared';
        }
      } else {
        base.explanation = `Selector "${selector}" was never found in the DOM within ${parsed.timeoutMs ?? 'the'} timeout.`;
        details.push('The element may have never existed on the page');
        details.push('Possible causes: wrong selector, element loaded after timeout, or page structure changed');
        base.category = 'locator-not-found';
      }
      base.recommendation = 'Use a more specific locator, increase timeout, or wait for the element to appear with waitForSelector()';
      break;
    }

    case 'strict-mode-violation': {
      base.explanation = `Locator "${selector}" resolved to ${parsed.strictCount ?? 'multiple'} elements when exactly 1 was expected.`;
      details.push('Playwright strict mode requires the locator to match exactly one element');
      details.push('The locator is too broad');
      base.recommendation = 'Add more specificity: use getByTestId(), filter by text, or use .first()/.nth()';
      break;
    }

    case 'not-visible': {
      base.explanation = `Element "${selector}" exists in the DOM but is not visible.`;
      details.push('Common causes: display:none, visibility:hidden, zero bounding box');
      if (trace?.lastKnownState) {
        const s = trace.lastKnownState;
        details.push(`Element state: <${s.tag}> ${s.id ? `id="${s.id}" ` : ''}${s.className ? `class="${s.className}"` : ''}`);
      }
      base.recommendation = 'Use .waitFor({ state: "visible" }), check that display/visibility/opacity are correct, or use { force: true } if intentional';
      break;
    }

    case 'not-stable': {
      base.explanation = `Element "${selector}" is not stable — its position or size is still changing.`;
      details.push('Playwright waits for 2 consecutive animation frames with the same bounding box');
      details.push('Likely cause: CSS animation, transition, or JavaScript-driven layout change');
      base.recommendation = 'Wait for animation to finish with locator.waitFor(), use { force: true }, or disable animations in test config';
      break;
    }

    case 'not-enabled': {
      base.explanation = `Element "${selector}" is disabled and cannot be interacted with.`;
      details.push('Element has [disabled] attribute, is inside disabled <fieldset>, or has aria-disabled=true');
      base.recommendation = 'Wait for the element to become enabled, or check if the button should be clickable at this point';
      break;
    }

    case 'obscured': {
      base.explanation = `Element "${selector}" exists but is obscured by another element.`;
      details.push('Another element (overlay, modal, toast, cookie banner) intercepts the click at the action point');
      base.recommendation = 'Dismiss the blocking overlay, use page.addLocatorHandler(), or use { force: true }';
      break;
    }

    case 'not-editable': {
      base.explanation = `Element "${selector}" is not editable — fill() requires <input>, <textarea>, or [contenteditable].`;
      details.push('The element matched by the locator is not an input-like element');
      base.recommendation = 'Use a more specific locator targeting the actual input field, or use click() + keyboard.fill() approach';
      break;
    }

    case 'not-focusable': {
      base.explanation = `Element "${selector}" is not focusable — type()/fill() requires a focusable element.`;
      base.recommendation = 'Use click() to focus the element first, or use a different locator';
      break;
    }

    case 'not-checkbox': {
      base.explanation = `Element "${selector}" is not a checkbox or radio button.`;
      details.push('check()/uncheck() can only be used on <input type="checkbox"> and <input type="radio">');
      base.recommendation = 'Use click() instead, or verify the locator points to a checkbox/radio element';
      break;
    }

    case 'detached': {
      base.explanation = `Element "${selector}" was removed from the DOM while Playwright was interacting with it.`;
      details.push('The element existed when the action started but was detached before completion');
      details.push('Likely caused by: re-render, SPA navigation, or dynamic content replacement');
      base.recommendation = 'Use a more resilient locator, wait for the element to stabilize before interacting, or use { force: true }';
      base.category = 'dom-disappeared';
      break;
    }

    case 'target-closed': {
      base.explanation = `The target page or context was closed while trying to interact with "${selector}".`;
      details.push('The action triggered a navigation or page close');
      details.push('Common pattern: clicking a link that opens a new tab, or navigation race condition');
      base.recommendation = 'Use Promise.all([page.waitForURL(), locator.click()]) pattern, or check popup/new tab handling';
      break;
    }

    case 'frame-detached': {
      base.explanation = `The frame containing "${selector}" was detached from the DOM.`;
      details.push('The iframe was removed, replaced, or its parent page re-rendered');
      details.push('Common in: SPA apps where iframes are mounted/unmounted dynamically');
      base.recommendation = 'Re-query the frame locator before interacting, or wait for the frame to be attached again';
      break;
    }

    case 'execution-context-destroyed':
    case 'page-crash': {
      base.explanation = `The page execution context was destroyed — page likely crashed or was forcefully closed.`;
      details.push('Possible causes: out of memory, tab crash, page.close() during evaluate()');
      base.recommendation = 'Check browser memory usage, reduce test parallelism, ensure no race conditions with page.close()';
      break;
    }

    case 'network-error': {
      const code = parsed.networkErrorCode ?? 'UNKNOWN';
      const messages: Record<string, string> = {
        ERR_CONNECTION_REFUSED: 'Connection refused — server is not running or port is wrong',
        ERR_CONNECTION_TIMED_OUT: 'Connection timed out — server unreachable or firewall blocking',
        ERR_DNS_ADDRESS_NOT_RESOLVED: 'DNS lookup failed — hostname does not exist',
        ERR_NAME_NOT_RESOLVED: 'DNS lookup failed — hostname does not exist',
        ERR_CERT_AUTHORITY_INVALID: 'SSL certificate invalid — self-signed or expired certificate',
        ERR_ABORTED: 'Request was aborted — navigation cancelled or interrupted',
        ERR_INTERNET_DISCONNECTED: 'No internet connection',
        ERR_SSL_PROTOCOL_ERROR: 'SSL protocol error — misconfigured HTTPS',
        ERR_UNSAFE_PORT: 'Port is blocked by the browser — use a standard port (80, 443) or a port above 1024',
        ERR_ADDRESS_UNREACHABLE: 'Address unreachable — network or firewall issue',
        ERR_EMPTY_RESPONSE: 'Empty response — server closed connection without sending data',
      };
      base.explanation = `Network error (${code}): ${messages[code] ?? 'Unknown network error'}`;
      details.push(`Error code: ${code}`);
      details.push(messages[code] ?? 'Unknown network error. Check the URL and server availability.');
      base.recommendation = 'Ensure the server is running, check the URL, verify SSL certificate, or use page.route() to mock the request';
      break;
    }

    case 'navigation-timeout': {
      base.explanation = `Page navigation timed out after ${parsed.timeoutMs ?? 'the configured'} ms.`;
      details.push('The page did not reach "load" state within the timeout');
      details.push('Possible causes: large assets, slow API responses, infinite loading spinner, redirect loop');
      base.recommendation = 'Increase navigation timeout, use waitUntil: "domcontentloaded", or check for stuck loading states';
      break;
    }

    case 'assertion-text-mismatch': {
      base.explanation = `Text assertion failed for "${selector}".`;
      if (parsed.expectedValue && parsed.actualValue !== undefined) {
        details.push(`Expected: "${parsed.expectedValue}"`);
        details.push(`Received: "${parsed.actualValue}"`);
      }
      base.recommendation = 'Check that the element has loaded the expected content, or use regex matching for dynamic text';
      break;
    }

    case 'assertion-count-mismatch': {
      base.explanation = `Element count assertion failed for "${selector}".`;
      if (parsed.expectedValue !== undefined && parsed.actualValue !== undefined) {
        details.push(`Expected: ${parsed.expectedValue} elements`);
        details.push(`Found: ${parsed.actualValue} elements`);
      }
      base.recommendation = 'Check that all elements have been loaded, or the locator is specific enough';
      break;
    }

    case 'assertion-attribute-mismatch': {
      base.explanation = `Attribute/class/CSS/value assertion failed for "${selector}".`;
      if (parsed.expectedValue !== undefined && parsed.actualValue !== undefined) {
        details.push(`Expected: "${parsed.expectedValue}"`);
        details.push(`Received: "${parsed.actualValue}"`);
      }
      base.recommendation = 'Verify the attribute value is correct, or use a more flexible matching pattern';
      break;
    }

    case 'assertion-visibility': {
      base.explanation = `Visibility assertion failed for "${selector}".`;
      if (trace?.lastKnownState) {
        details.push(`Element visible: ${trace.lastKnownState.visible}`);
      }
      base.recommendation = 'Wait for the element to become visible with toBeVisible() (auto-retries), or check the element state';
      break;
    }

    case 'assertion-url-mismatch': {
      base.explanation = `URL or title assertion failed.`;
      if (parsed.expectedValue !== undefined && parsed.actualValue !== undefined) {
        details.push(`Expected: "${parsed.expectedValue}"`);
        details.push(`Received: "${parsed.actualValue}"`);
      }
      base.recommendation = 'Check page navigation flow, SPA routing, or use regex for partial URL matching';
      break;
    }

    case 'assertion-screenshot': {
      base.explanation = `Screenshot comparison failed.`;
      details.push('Visual difference detected between reference and current screenshot');
      base.recommendation = 'Update snapshots with --update-snapshots, mask dynamic areas, or check for rendering differences';
      break;
    }

    case 'assertion-api-response': {
      base.explanation = `API response assertion failed.`;
      if (parsed.actualValue) {
        details.push(`Received status: ${parsed.actualValue}`);
      }
      base.recommendation = 'Check API endpoint availability, mock the API, or handle the error in test logic';
      break;
    }

    case 'assertion-other': {
      base.explanation = `An assertion failed for "${selector}".`;
      base.recommendation = 'Check the element state and expected condition';
      break;
    }

    default: {
      base.explanation = `An unknown error occurred while interacting with "${selector}".`;
      base.recommendation = 'Check the full error message for details';
      break;
    }
  }

  base.details = details.length > 0 ? details : undefined;
  return base;
}

export function renderVerdictText(v: Verdict): string {
  const lines: string[] = [
    `${v.icon} ${v.label}`,
    '',
    v.explanation,
  ];
  if (v.details?.length) {
    lines.push('');
    for (const d of v.details) {
      lines.push(`  • ${d}`);
    }
  }
  if (v.recommendation) {
    lines.push('');
    lines.push(`🔧 Recommendation: ${v.recommendation}`);
  }
  return lines.join('\n');
}

export function renderVerdictHtml(v: Verdict): string {
  let html = `<strong>${escapeHtml(v.icon)} ${escapeHtml(v.label)}</strong><br><br>${escapeHtml(v.explanation)}`;
  if (v.details?.length) {
    html += '<ul>';
    for (const d of v.details) {
      html += `<li>${escapeHtml(d)}</li>`;
    }
    html += '</ul>';
  }
  if (v.recommendation) {
    html += `<br><strong>🔧 Recommendation:</strong> ${escapeHtml(v.recommendation)}`;
  }
  return html;
}
