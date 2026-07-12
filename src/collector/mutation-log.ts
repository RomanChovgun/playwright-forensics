export interface MutationRecord {
  type: 'childList' | 'attributes' | 'characterData';
  target: string;
  attributeName?: string;
  oldValue?: string;
  newValue?: string;
  addedNodes: number;
  removedNodes: number;
  /** UTC timestamp from Date.now() */
  timestamp: number;
}

export interface MutationLogOptions {
  maxRecords: number;
  maxTextLength: number;
  redaction: {
    enabled: boolean;
    replacement: string;
    attributes: string[];
    textPatterns: string[];
    urlQuery: boolean;
  };
}

export interface MutationFlush {
  records: MutationRecord[];
  dropped: number;
}

/** Array-compatible for consumers of the v1 mutationLogs API. */
export type MutationBatch = MutationRecord[] & {
  snapshotIndex: number;
  startedAt: number;
  flushedAt: number;
  dropped: number;
};

declare global {
  interface Window {
    __forensicsMutationRecords?: MutationRecord[];
    __forensicsMutationObserver?: MutationObserver;
    __forensicsMutationDropped?: number;
    __forensicsMutationStartedAt?: number;
    __forensicsMutationProcess?: (mutations: globalThis.MutationRecord[]) => void;
  }
}

/** Starts a bounded MutationObserver on the full document. */
export function startMutationLog(options: MutationLogOptions): void {
  window.__forensicsMutationObserver?.disconnect();
  window.__forensicsMutationRecords = [];
  window.__forensicsMutationDropped = 0;
  window.__forensicsMutationStartedAt = Date.now();
  const truncate = (value: string | null): string | undefined => {
    if (value === null) return undefined;
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length <= options.maxTextLength) return normalized || undefined;
    return `${normalized.slice(0, options.maxTextLength)}…[truncated]`;
  };
  const redact = (name: string | null, value: string | null): string | undefined => {
    if (value === null) return undefined;
    if (options.redaction.enabled && name && (
      options.redaction.attributes.includes(name.toLowerCase())
      || /(?:token|secret|password|passwd|api[-_]?key|auth|session|cookie)/i.test(name)
    )) return options.redaction.replacement;
    if (options.redaction.enabled && options.redaction.urlQuery && name && ['href', 'src', 'action', 'formaction'].includes(name.toLowerCase())) {
      const query = value.indexOf('?');
      if (query >= 0) return truncate(`${value.slice(0, query)}?${options.redaction.replacement}`);
    }
    if (options.redaction.enabled && !name) {
      let safe = value;
      for (const pattern of options.redaction.textPatterns) {
        try { safe = safe.replace(new RegExp(pattern, 'gi'), options.redaction.replacement); } catch { /* invalid user pattern */ }
      }
      return truncate(safe);
    }
    return truncate(value);
  };

  function getSelectorPath(element: Element | null): string {
    if (!element || element === document.body || element === document.documentElement) {
      return element?.tagName?.toLowerCase() ?? 'unknown';
    }

    const parts: string[] = [];
    let current: Element | null = element;

    while (current && current !== document.body && current !== document.documentElement) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        selector += `#${current.id}`;
        parts.unshift(selector);
        break;
      }
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/).slice(0, 2).join('.');
        if (classes) selector += `.${classes}`;
      }

      const el = current;
      const parent = el.parentElement;
      if (parent) {
        let index = 1;
        let found = false;
        for (let sib: Element | null = parent.firstElementChild; sib; sib = sib.nextElementSibling) {
          if (sib.tagName === el.tagName) {
            if (sib === el) { found = true; break; }
            index++;
          }
        }
        if (found && index > 1) selector += `:nth-of-type(${index})`;
      }

      parts.unshift(selector);
      current = current.parentElement;
    }

    return parts.join(' > ');
  }

  const processMutations = (mutations: globalThis.MutationRecord[]) => {
    for (const m of mutations) {
      const targetPath = getSelectorPath(m.target as Element);
      const rec: MutationRecord = {
        type: m.type as MutationRecord['type'],
        target: targetPath,
        addedNodes: m.addedNodes.length,
        removedNodes: m.removedNodes.length,
        timestamp: Date.now(),
      };

      if (m.type === 'attributes' && m.attributeName) {
        rec.attributeName = m.attributeName;
        rec.oldValue = redact(m.attributeName, m.oldValue);
        rec.newValue = redact(m.attributeName, (m.target as Element).getAttribute(m.attributeName));
      }

      if (m.type === 'characterData') {
        rec.oldValue = redact(null, m.oldValue);
        rec.newValue = redact(null, m.target.textContent);
      }

      window.__forensicsMutationRecords!.push(rec);
      if (window.__forensicsMutationRecords!.length > options.maxRecords) {
        window.__forensicsMutationRecords!.shift();
        window.__forensicsMutationDropped = (window.__forensicsMutationDropped ?? 0) + 1;
      }
    }
  };
  window.__forensicsMutationProcess = processMutations;
  const observer = new MutationObserver(processMutations);

  observer.observe(document.documentElement, {
    childList: true,
    attributes: true,
    characterData: true,
    subtree: true,
    attributeOldValue: true,
    characterDataOldValue: true,
  });

  window.__forensicsMutationObserver = observer;
}

/**
 * Stops the observer, returns all records, and cleans up globals.
 */
export function stopMutationLog(): MutationRecord[] {
  const observer = window.__forensicsMutationObserver;
  if (observer) {
    window.__forensicsMutationProcess?.(observer.takeRecords());
    observer.disconnect();
  }
  const records = window.__forensicsMutationRecords ?? [];
  delete window.__forensicsMutationRecords;
  delete window.__forensicsMutationObserver;
  delete window.__forensicsMutationDropped;
  delete window.__forensicsMutationStartedAt;
  delete window.__forensicsMutationProcess;
  return records;
}

/** Flushes pending browser records and removes observer state. */
export function flushMutationLog(): MutationFlush {
  const observer = window.__forensicsMutationObserver;
  if (observer) {
    window.__forensicsMutationProcess?.(observer.takeRecords());
    observer.disconnect();
  }

  const records = window.__forensicsMutationRecords ?? [];
  const dropped = window.__forensicsMutationDropped ?? 0;
  delete window.__forensicsMutationRecords;
  delete window.__forensicsMutationObserver;
  delete window.__forensicsMutationDropped;
  delete window.__forensicsMutationStartedAt;
  delete window.__forensicsMutationProcess;
  return { records, dropped };
}
