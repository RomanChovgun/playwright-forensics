import type { DomNode } from '../../collector/dom-snapshot.js';
import type { LocatorExpression, LocatorStep, TextMatcher } from './types.js';

export interface LocatorQueryResult {
  nodes: DomNode[];
  confidence: 'confirmed' | 'likely' | 'insufficient-evidence';
  limitations: string[];
}

function descendants(node: DomNode, includeSelf = true): DomNode[] {
  const result: DomNode[] = includeSelf ? [node] : [];
  for (const child of node.children) result.push(...descendants(child));
  return result;
}

function matchesText(value: string | undefined, matcher: TextMatcher): boolean {
  if (value === undefined) return false;
  if (matcher.regex) {
    try { return new RegExp(matcher.value, matcher.flags).test(value); } catch { return false; }
  }
  return matcher.exact ? value === matcher.value : value.toLocaleLowerCase().includes(matcher.value.toLocaleLowerCase());
}

function nodeText(node: DomNode): string {
  return node.directText ?? (node.children.length === 0 ? node.text ?? '' : '');
}

function matchesSimpleCss(node: DomNode, selector: string): boolean {
  const not = selector.match(/:not\(([^)]+)\)/)?.[1];
  if (not && matchesSimpleCss(node, not)) return false;
  const clean = selector.replace(/:not\([^)]+\)/g, '').replace(/:[a-z-]+(?:\([^)]*\))?/g, '');
  const tag = clean.match(/^[a-z][\w-]*/i)?.[0]?.toLowerCase();
  if (tag && node.tag !== tag) return false;
  const id = clean.match(/#([\w-]+)/)?.[1];
  if (id && node.id !== id) return false;
  const classes = [...clean.matchAll(/\.([\w-]+)/g)].map(m => m[1]);
  const nodeClasses = new Set((node.className ?? '').split(/\s+/));
  if (classes.some(value => !nodeClasses.has(value))) return false;
  for (const attr of clean.matchAll(/\[([\w:-]+)(?:\s*([~|^$*]?=)\s*["']?([^"'\]]+)["']?)?\]/g)) {
    const actual = node.attributes[attr[1]];
    if (actual === undefined) return false;
    if (!attr[2]) continue;
    const expected = attr[3];
    if (attr[2] === '=' && actual !== expected) return false;
    if (attr[2] === '*=' && !actual.includes(expected)) return false;
    if (attr[2] === '^=' && !actual.startsWith(expected)) return false;
    if (attr[2] === '$=' && !actual.endsWith(expected)) return false;
    if (attr[2] === '~=' && !actual.split(/\s+/).includes(expected)) return false;
  }
  return true;
}

function queryCss(root: DomNode, selector: string): DomNode[] {
  const final = selector.trim().split(/\s+|>/).filter(Boolean).at(-1);
  if (!final) return [];
  return descendants(root).filter(node => matchesSimpleCss(node, final));
}

function queryXpath(root: DomNode, expression: string): DomNode[] {
  const match = expression.match(/\/\/([a-z*][\w-]*)(?:\[@([\w:-]+)=['"]([^'"]+)['"]\])?/i);
  if (!match) return [];
  return descendants(root).filter(node =>
    (match[1] === '*' || node.tag === match[1].toLowerCase())
    && (!match[2] || node.attributes[match[2]] === match[3]));
}

function queryStep(root: DomNode, step: LocatorStep): DomNode[] {
  const nodes = descendants(root);
  switch (step.kind) {
    case 'testId': return nodes.filter(node => matchesText(node.attributes['data-testid'], { ...step.matcher, exact: true }));
    case 'text': return nodes.filter(node => matchesText(nodeText(node), step.matcher));
    case 'label': return nodes.filter(node => matchesText(node.accessibleName ?? node.attributes['aria-label'], step.matcher));
    case 'placeholder': return nodes.filter(node => matchesText(node.attributes.placeholder, step.matcher));
    case 'altText': return nodes.filter(node => matchesText(node.attributes.alt, step.matcher));
    case 'title': return nodes.filter(node => matchesText(node.attributes.title, step.matcher));
    case 'role': return nodes.filter(node => {
      const role = node.attributes.role ?? node.implicitRole;
      return role === step.role && (!step.name || matchesText(node.accessibleName ?? nodeText(node), step.name));
    });
    case 'css': return queryCss(root, step.value);
    case 'xpath': return queryXpath(root, step.value);
    case 'frame': return queryCss(root, step.value).filter(node => node.tag === 'iframe');
    default: return [];
  }
}

export function queryLocator(root: DomNode, expression: LocatorExpression): LocatorQueryResult {
  let current: DomNode[] = [root];
  const limitations = [...(expression.unsupported ?? [])];
  let hasQuery = false;
  for (const step of expression.steps) {
    if (step.kind === 'filter') {
      current = current.filter(node => {
        const text = node.text ?? nodeText(node);
        return (!step.hasText || matchesText(text, step.hasText))
          && (!step.hasNotText || !matchesText(text, step.hasNotText));
      });
      continue;
    }
    if (step.kind === 'nth') {
      const index = step.index < 0 ? current.length + step.index : step.index;
      current = current[index] ? [current[index]] : [];
      continue;
    }
    if (step.kind === 'first' || step.kind === 'last') {
      const node = step.kind === 'first' ? current[0] : current.at(-1);
      current = node ? [node] : [];
      continue;
    }
    const next: DomNode[] = [];
    for (const candidate of current) next.push(...queryStep(candidate, step));
    current = [...new Set(next)];
    hasQuery = true;
    if (step.kind === 'frame') limitations.push('iframe document snapshots are unavailable');
  }
  const confidence = limitations.length > 0 || !hasQuery
    ? 'insufficient-evidence'
    : current.length === 1 ? 'confirmed' : 'likely';
  return { nodes: current, confidence, limitations };
}
