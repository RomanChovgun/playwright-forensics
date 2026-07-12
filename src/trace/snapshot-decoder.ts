import type { DomNode } from '../collector/dom-snapshot.js';
import type { ForensicsConfig } from '../config.js';

export type TraceNodeSnapshot =
  | string
  | [[number, number]]
  | [string]
  | [string, Record<string, string>, ...TraceNodeSnapshot[]];

export interface RawFrameSnapshot {
  snapshotName?: string;
  callId: string;
  pageId: string;
  frameId: string;
  frameUrl: string;
  timestamp: number;
  wallTime?: number;
  html: TraceNodeSnapshot;
  isMainFrame: boolean;
}

function isReference(value: TraceNodeSnapshot): value is [[number, number]] {
  return Array.isArray(value)
    && value.length === 1
    && Array.isArray(value[0])
    && value[0].length === 2
    && value[0].every(item => typeof item === 'number');
}

function rawNodeAt(root: TraceNodeSnapshot, target: number): TraceNodeSnapshot | undefined {
  let index = -1;
  let found: TraceNodeSnapshot | undefined;
  const visit = (node: TraceNodeSnapshot, depth = 0) => {
    if (depth > 200) return;
    if (found || isReference(node)) return;
    if (Array.isArray(node) && node.length > 1) {
      for (const child of node.slice(2) as TraceNodeSnapshot[]) visit(child, depth + 1);
    }
    index++;
    if (index === target) found = node;
  };
  visit(root);
  return found;
}

function resolveNode(
  snapshots: RawFrameSnapshot[],
  snapshotIndex: number,
  node: TraceNodeSnapshot,
  seen: Set<string>,
): { node: TraceNodeSnapshot; snapshotIndex: number } | undefined {
  if (!isReference(node)) return { node, snapshotIndex };
  const [distance, nodeIndex] = node[0];
  const targetIndex = snapshotIndex - distance;
  const key = `${targetIndex}:${nodeIndex}`;
  if (targetIndex < 0 || seen.has(key)) return undefined;
  const target = snapshots[targetIndex];
  if (!target) return undefined;
  const referenced = rawNodeAt(target.html, nodeIndex);
  if (!referenced) return undefined;
  const nextSeen = new Set(seen);
  nextSeen.add(key);
  return resolveNode(snapshots, targetIndex, referenced, nextSeen);
}

function safeText(value: string, config: ForensicsConfig): string {
  let safe = value.replace(/\s+/g, ' ').trim();
  if (config.redaction.enabled) {
    for (const pattern of config.redaction.textPatterns) {
      try { safe = safe.replace(new RegExp(pattern, 'gi'), config.redaction.replacement); } catch { /* invalid user pattern */ }
    }
  }
  return safe.length > config.maxTextLength
    ? `${safe.slice(0, config.maxTextLength)}…[truncated]`
    : safe;
}

function safeAttribute(name: string, value: string, config: ForensicsConfig): string {
  const lower = name.toLowerCase();
  if (config.redaction.enabled && (
    config.redaction.attributes.includes(lower)
    || /(?:token|secret|password|passwd|api[-_]?key|auth|session|cookie)/i.test(lower)
  )) return config.redaction.replacement;
  if (config.redaction.enabled && config.redaction.urlQuery
    && ['href', 'src', 'action', 'formaction'].includes(lower) && value.includes('?')) {
    return `${value.slice(0, value.indexOf('?'))}?${config.redaction.replacement}`;
  }
  return safeText(value, config);
}

function roleFor(tag: string, attributes: Record<string, string>): string | undefined {
  if (attributes.role) return undefined;
  if (tag === 'button') return 'button';
  if (tag === 'a' && attributes.href) return 'link';
  if (tag === 'img') return 'img';
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'select') return attributes.multiple !== undefined ? 'listbox' : 'combobox';
  if (tag === 'input') {
    const type = (attributes.type || 'text').toLowerCase();
    if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'range') return 'slider';
    if (type === 'number') return 'spinbutton';
    if (!['hidden', 'password'].includes(type)) return 'textbox';
  }
  return undefined;
}

function visibleFromSnapshot(attributes: Record<string, string>): boolean {
  if (attributes.hidden !== undefined || attributes['aria-hidden'] === 'true') return false;
  const style = attributes.style ?? '';
  return !/(?:^|;)\s*display\s*:\s*none\b/i.test(style)
    && !/(?:^|;)\s*visibility\s*:\s*(?:hidden|collapse)\b/i.test(style)
    && !/(?:^|;)\s*opacity\s*:\s*0(?:[;\s]|$)/i.test(style);
}

export function decodeFrameSnapshots(
  snapshots: RawFrameSnapshot[],
  config: ForensicsConfig,
): { history: DomNode[]; warnings: string[] } {
  const history: DomNode[] = [];
  const warnings: string[] = [];
  const limited = snapshots.slice(-config.snapshotCount);
  const offset = snapshots.length - limited.length;
  for (let localIndex = 0; localIndex < limited.length; localIndex++) {
    const snapshotIndex = offset + localIndex;
    let nodeCount = 0;
    let omitted = 0;
    const convert = (
      raw: TraceNodeSnapshot,
      path: string,
      sourceIndex = snapshotIndex,
      depth = 0,
    ): DomNode | undefined => {
      if (depth > 200) {
        warnings.push(`Snapshot ${snapshotIndex} exceeded maximum DOM depth`);
        omitted++;
        return undefined;
      }
      const resolved = resolveNode(snapshots, sourceIndex, raw, new Set());
      if (resolved === undefined) {
        warnings.push(`Unresolved subtree reference in snapshot ${snapshotIndex}`);
        return undefined;
      }
      const resolvedNode = resolved.node;
      if (typeof resolvedNode === 'string' || isReference(resolvedNode)) return undefined;
      if (nodeCount >= config.maxNodes) { omitted++; return undefined; }
      nodeCount++;
      const tag = resolvedNode[0].toLowerCase();
      const sourceAttributes: Record<string, string> = resolvedNode.length > 1 && resolvedNode[1] ? resolvedNode[1] : {};
      const attributes: Record<string, string> = {};
      for (const [name, value] of Object.entries(sourceAttributes)) {
        if (!name.startsWith('_')) attributes[name] = safeAttribute(name, value, config);
      }
      const rawChildren = resolvedNode.length > 1 ? resolvedNode.slice(2) as TraceNodeSnapshot[] : [];
      const directText = safeText(rawChildren
        .map(child => typeof child === 'string' ? child : '')
        .join(' '), config) || undefined;
      const result: DomNode = {
        schemaVersion: 2,
        tag,
        id: attributes.id || undefined,
        className: attributes.class || undefined,
        text: directText,
        directText,
        attributes,
        children: [],
        visible: visibleFromSnapshot(attributes),
        implicitRole: roleFor(tag, attributes),
        accessibleName: attributes['aria-label'] || attributes.alt || attributes.title || undefined,
        structuralId: `${path}|${tag}`,
        path,
      };
      const bools = ['disabled', 'checked', 'readonly', 'required', 'hidden', 'selected', 'multiple', 'open']
        .filter(name => attributes[name] !== undefined);
      if (bools.length) result.booleanAttrs = bools;
      let childIndex = 0;
      for (const child of rawChildren) {
        if (typeof child === 'string') continue;
        const converted = convert(child, `${path}/${tag}:nth-child(${++childIndex})`, resolved.snapshotIndex, depth + 1);
        if (converted) result.children.push(converted);
      }
      return result;
    };
    const root = convert(limited[localIndex].html, '/trace');
    if (!root) continue;
    root.capturedAt = limited[localIndex].wallTime;
    if (omitted) root.truncated = { reason: 'nodes', omitted };
    let removedForBytes = 0;
    const byteLength = () => new TextEncoder().encode(JSON.stringify(root)).byteLength;
    while (byteLength() > config.maxSnapshotBytes) {
      const parents: DomNode[] = [];
      const visit = (node: DomNode) => {
        if (node.children.length) parents.push(node);
        for (const child of node.children) visit(child);
      };
      visit(root);
      const parent = parents.at(-1);
      const removed = parent?.children.pop();
      if (!removed) break;
      const count = (node: DomNode): number =>
        1 + node.children.reduce((total, child) => total + count(child), 0);
      removedForBytes += count(removed);
      root.truncated = { reason: 'bytes', omitted: omitted + removedForBytes };
    }
    history.push(root);
  }
  return { history, warnings: [...new Set(warnings)] };
}
