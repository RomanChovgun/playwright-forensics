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

declare global {
  interface Window {
    __forensicsMutationRecords?: MutationRecord[];
    __forensicsMutationObserver?: MutationObserver;
  }
}

/**
 * Starts a MutationObserver on the full document.
 *
 * ⚠️ Memory: every mutation is stored on `window.__forensicsMutationRecords`
 *    without a size limit. For long-running tests or pages with high mutation
 *    rates, the array can grow large. Call `stopMutationLog()` or limit test
 *    duration to keep memory bounded. The array is NOT automatically cleared
 *    across same-origin page navigations.
 */
export function startMutationLog(): void {
  window.__forensicsMutationRecords = [];

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

  const observer = new MutationObserver((mutations) => {
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
        rec.oldValue = m.oldValue ?? undefined;
        rec.newValue = (m.target as Element).getAttribute(m.attributeName) ?? undefined;
      }

      if (m.type === 'characterData') {
        rec.oldValue = m.oldValue ?? undefined;
        rec.newValue = m.target.textContent ?? undefined;
      }

      window.__forensicsMutationRecords!.push(rec);
    }
  });

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
  if (observer) observer.disconnect();

  const records = window.__forensicsMutationRecords ?? [];
  delete window.__forensicsMutationRecords;
  delete window.__forensicsMutationObserver;
  return records;
}
