import type { LocatorExpression, LocatorStep, TextMatcher } from './types.js';

function parseMatcher(raw: string): TextMatcher | undefined {
  const value = raw.trim();
  const stringMatch = value.match(/^(['"])([\s\S]*?)\1/);
  if (stringMatch) return { value: stringMatch[2] };
  const regexMatch = value.match(/^\/((?:\\.|[^/])+)\/([a-z]*)/);
  if (regexMatch) return { value: regexMatch[1], regex: true, flags: regexMatch[2] };
  return undefined;
}

function balancedCalls(source: string): { name: string; args: string }[] {
  const calls: { name: string; args: string }[] = [];
  const callStart = /(?:^|[.\s])(getByTestId|getByText|getByRole|getByLabel|getByPlaceholder|getByAltText|getByTitle|locator|frameLocator|filter|nth|first|last)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = callStart.exec(source))) {
    const start = callStart.lastIndex;
    let depth = 1;
    let quote = '';
    let regex = false;
    let escaped = false;
    let index = start;
    for (; index < source.length && depth > 0; index++) {
      const char = source[index];
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (quote) { if (char === quote) quote = ''; continue; }
      if (regex) { if (char === '/') regex = false; continue; }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === '/' && source[index - 1] !== '/') { regex = true; continue; }
      if (char === '(' || char === '{' || char === '[') depth++;
      if (char === ')' || char === '}' || char === ']') depth--;
    }
    calls.push({ name: match[1], args: source.slice(start, Math.max(start, index - 1)) });
    callStart.lastIndex = index;
  }
  return calls;
}

function optionMatcher(args: string, key: string): TextMatcher | undefined {
  const match = args.match(new RegExp(`${key}\\s*:\\s*((?:['"][\\s\\S]*?['"])|(?:/(?:\\\\.|[^/])+/[a-z]*))`));
  const parsed = match ? parseMatcher(match[1]) : undefined;
  if (parsed && /\bexact\s*:\s*true/.test(args)) parsed.exact = true;
  return parsed;
}

export function parseLocatorExpression(source: string): LocatorExpression | undefined {
  const locatorLine = source.match(/Locator:\s*(.+)/)?.[1]?.trim();
  const expressionSource = locatorLine || source;
  const calls = balancedCalls(expressionSource);
  if (calls.length === 0) return undefined;
  const steps: LocatorStep[] = [];
  const unsupported: string[] = [];
  for (const call of calls) {
    const matcher = parseMatcher(call.args);
    switch (call.name) {
      case 'getByTestId': if (matcher) steps.push({ kind: 'testId', matcher }); break;
      case 'getByText': if (matcher) {
        matcher.exact = matcher.exact || /\bexact\s*:\s*true/.test(call.args);
        steps.push({ kind: 'text', matcher });
      } break;
      case 'getByLabel': if (matcher) steps.push({ kind: 'label', matcher }); break;
      case 'getByPlaceholder': if (matcher) steps.push({ kind: 'placeholder', matcher }); break;
      case 'getByAltText': if (matcher) steps.push({ kind: 'altText', matcher }); break;
      case 'getByTitle': if (matcher) steps.push({ kind: 'title', matcher }); break;
      case 'getByRole': if (matcher) steps.push({ kind: 'role', role: matcher.value, name: optionMatcher(call.args, 'name') }); break;
      case 'locator': if (matcher) steps.push({
        kind: matcher.value.startsWith('xpath=') || matcher.value.startsWith('//') ? 'xpath' : 'css',
        value: matcher.value.replace(/^xpath=/, '').replace(/^css=/, ''),
      }); break;
      case 'frameLocator': if (matcher) steps.push({ kind: 'frame', value: matcher.value }); break;
      case 'filter': {
        const hasText = optionMatcher(call.args, 'hasText');
        const hasNotText = optionMatcher(call.args, 'hasNotText');
        if (/\bhas(Not)?\s*:/.test(call.args)) unsupported.push('filter.has/hasNot');
        steps.push({ kind: 'filter', hasText, hasNotText });
        break;
      }
      case 'nth': {
        const index = Number.parseInt(call.args, 10);
        if (Number.isInteger(index)) steps.push({ kind: 'nth', index });
        break;
      }
      case 'first': steps.push({ kind: 'first' }); break;
      case 'last': steps.push({ kind: 'last' }); break;
    }
  }
  if (steps.length === 0) return undefined;
  return { source: expressionSource, steps, unsupported: unsupported.length ? unsupported : undefined };
}
