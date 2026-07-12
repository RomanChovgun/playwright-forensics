export interface DomNode {
  tag: string;
  id?: string;
  className?: string;
  text?: string;
  attributes: Record<string, string>;
  children: DomNode[];
  visible: boolean;
  shadowRoot?: boolean;
  booleanAttrs?: string[];
  /** Present on schema-v2 snapshots; omitted in legacy snapshots. */
  schemaVersion?: 2;
  directText?: string;
  implicitRole?: string;
  accessibleName?: string;
  structuralId?: string;
  path?: string;
  capturedAt?: number;
  value?: string;
  truncated?: {
    reason: 'nodes' | 'bytes';
    omitted: number;
  };
}

export interface SnapshotOptions {
  maxNodes: number;
  maxSnapshotBytes: number;
  maxTextLength: number;
  redaction: {
    enabled: boolean;
    replacement: string;
    attributes: string[];
    textPatterns: string[];
    urlQuery: boolean;
  };
}

export function collectDomSnapshot(input?: Partial<SnapshotOptions>): DomNode {
  const defaults: SnapshotOptions = {
    maxNodes: 5_000,
    maxSnapshotBytes: 2_000_000,
    maxTextLength: 500,
    redaction: {
      enabled: true,
      replacement: '[REDACTED]',
      attributes: ['authorization', 'cookie', 'set-cookie', 'value', 'data-token', 'data-secret', 'data-password'],
      textPatterns: [
        String.raw`\bBearer\s+[A-Za-z0-9._~+/-]+=*\b`,
        String.raw`\b(?:token|secret|password|passwd|api[-_]?key)\s*[:=]\s*[^\s,;]+`,
      ],
      urlQuery: true,
    },
  };
  const options: SnapshotOptions = {
    ...defaults,
    ...input,
    redaction: { ...defaults.redaction, ...input?.redaction },
  };
  let nodeCount = 0;
  let omittedNodes = 0;

  const truncate = (value: string | null | undefined): string | undefined => {
    let normalized = value?.replace(/\s+/g, ' ').trim();
    if (!normalized) return undefined;
    if (options.redaction.enabled) {
      for (const pattern of options.redaction.textPatterns) {
        try { normalized = normalized.replace(new RegExp(pattern, 'gi'), options.redaction.replacement); } catch { /* invalid user pattern */ }
      }
    }
    if (normalized.length <= options.maxTextLength) return normalized;
    return `${normalized.slice(0, options.maxTextLength)}…[truncated]`;
  };

  const redactUrl = (value: string): string => {
    if (!options.redaction.enabled || !options.redaction.urlQuery || !value.includes('?')) return value;
    const hashIndex = value.indexOf('#');
    const queryIndex = value.indexOf('?');
    return `${value.slice(0, queryIndex)}?${options.redaction.replacement}${hashIndex >= 0 ? value.slice(hashIndex) : ''}`;
  };

  const redactAttribute = (name: string, value: string, node: Element): string => {
    if (!options.redaction.enabled) return truncate(value) ?? '';
    const lower = name.toLowerCase();
    const sensitive = options.redaction.attributes.includes(lower)
      || /(?:token|secret|password|passwd|api[-_]?key|auth|session|cookie)/i.test(lower)
      || (lower === 'value' && /^(input|textarea|select)$/i.test(node.tagName));
    if (sensitive) return options.redaction.replacement;
    if (['href', 'src', 'action', 'formaction'].includes(lower)) {
      const redacted = redactUrl(value);
      return redacted !== value ? redacted : truncate(redacted) ?? '';
    }
    return truncate(value) ?? '';
  };

  const implicitRole = (node: Element): string | undefined => {
    const tag = node.tagName.toLowerCase();
    if (tag === 'button') return 'button';
    if (tag === 'a' && node.hasAttribute('href')) return 'link';
    if (tag === 'img') return 'img';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return node.hasAttribute('multiple') ? 'listbox' : 'combobox';
    if (tag === 'input') {
      const type = (node.getAttribute('type') || 'text').toLowerCase();
      if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'range') return 'slider';
      if (type === 'number') return 'spinbutton';
      if (!['hidden', 'password'].includes(type)) return 'textbox';
    }
    if (tag === 'ul' || tag === 'ol') return 'list';
    if (tag === 'li') return 'listitem';
    if (tag === 'nav') return 'navigation';
    if (tag === 'main') return 'main';
    return undefined;
  };

  const accessibleName = (node: Element): string | undefined => {
    const aria = node.getAttribute('aria-label');
    if (aria) return truncate(aria);
    const labelledBy = node.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ');
      if (text.trim()) return truncate(text);
    }
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) {
      const text = Array.from(node.labels ?? []).map(label => label.textContent ?? '').join(' ');
      if (text.trim()) return truncate(text);
      if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
        if (node.placeholder) return truncate(node.placeholder);
      }
    }
    const tag = node.tagName.toLowerCase();
    if (['button', 'a', 'summary', 'option'].includes(tag)) return truncate(node.textContent);
    return truncate(node.getAttribute('alt') || node.getAttribute('title'));
  };

  const isVisible = (node: Element): boolean => {
    try {
      if (typeof node.checkVisibility === 'function') {
        return node.checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true,
          contentVisibilityAuto: true,
        });
      }
    } catch {
      // Older browsers may reject newer options.
    }
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) {
      return false;
    }
    return node.getClientRects().length > 0;
  };

  const serialize = (node: Element, path: string, inShadow: boolean = false): DomNode | undefined => {
    if (nodeCount >= options.maxNodes) {
      omittedNodes++;
      return undefined;
    }
    nodeCount++;
    const tag = node.tagName.toLowerCase();
    const attrs: Record<string, string> = {};
    for (const attr of Array.from(node.attributes)) {
      attrs[attr.name] = redactAttribute(attr.name, attr.value, node);
    }
    const childElements = Array.from(node.children);
    const directText = truncate(Array.from(node.childNodes)
      .filter(child => child.nodeType === Node.TEXT_NODE)
      .map(child => child.textContent ?? '')
      .join(' '));
    const result: DomNode = {
      tag,
      id: node.id || undefined,
      className: typeof node.className === 'string' ? truncate(node.className) : undefined,
      // v2 keeps the legacy field as an alias of direct text; descendant
      // text caused ancestor false positives and noisy diffs.
      text: directText,
      directText,
      attributes: attrs,
      children: [],
      visible: isVisible(node),
      shadowRoot: inShadow || undefined,
      implicitRole: node.hasAttribute('role') ? undefined : implicitRole(node),
      accessibleName: accessibleName(node),
      structuralId: `${path}|${tag}`,
      path,
    };
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) {
      result.value = options.redaction.enabled ? options.redaction.replacement : truncate(node.value);
    }

    const bools: string[] = [];
    for (const attr of ['disabled', 'checked', 'readonly', 'required', 'hidden', 'selected', 'multiple', 'open']) {
      if (node.hasAttribute(attr)) bools.push(attr);
    }
    if (bools.length > 0) result.booleanAttrs = bools;

    for (let index = 0; index < childElements.length; index++) {
      const child = childElements[index];
      const sameTagIndex = childElements.slice(0, index + 1).filter(candidate => candidate.tagName === child.tagName).length;
      const serialized = serialize(child, `${path}/${child.tagName.toLowerCase()}:nth-of-type(${sameTagIndex})`, false);
      if (serialized) result.children.push(serialized);
    }

    if (node.shadowRoot && node.shadowRoot.mode === 'open') {
      for (const child of Array.from(node.shadowRoot.children)) {
        const serialized = serialize(child, `${path}/#shadow/${child.tagName.toLowerCase()}`, true);
        if (serialized) result.children.push(serialized);
      }
    }

    return result;
  };

  const root = serialize(document.documentElement, '/html')!;
  root.schemaVersion = 2;
  root.capturedAt = Date.now();
  if (omittedNodes > 0) root.truncated = { reason: 'nodes', omitted: omittedNodes };

  const byteLength = () => new TextEncoder().encode(JSON.stringify(root)).byteLength;
  let removedForBytes = 0;
  while (byteLength() > options.maxSnapshotBytes) {
    const parents: DomNode[] = [];
    const visit = (current: DomNode) => {
      if (current.children.length > 0) parents.push(current);
      for (const child of current.children) visit(child);
    };
    visit(root);
    const parent = parents.at(-1);
    if (!parent) break;
    const removed = parent.children.pop();
    if (!removed) break;
    const count = (current: DomNode): number => 1 + current.children.reduce((sum, child) => sum + count(child), 0);
    removedForBytes += count(removed);
    root.truncated = { reason: 'bytes', omitted: omittedNodes + removedForBytes };
  }
  return root;
}
