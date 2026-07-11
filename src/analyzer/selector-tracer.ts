import type { DomNode } from '../collector/dom-snapshot.js';

export interface SelectorTrace {
  found: boolean;
  stepFound?: number;
  lastKnownState?: DomNode;
  disappearanceChanges?: string[];
}

export function traceSelector(
  locatorValue: string,
  snapshotHistory: DomNode[],
  failedStep: number,
  locatorType?: string,
): SelectorTrace {
  // Cache: pre-compute findNodeByLocator for all steps in a single pass
  const cache = snapshotHistory.map(s => findNodeByLocator(s, locatorValue, locatorType));

  const matchAtFailure = cache[failedStep];
  if (matchAtFailure) {
    return {
      found: true,
      stepFound: failedStep,
      lastKnownState: matchAtFailure,
      disappearanceChanges: [`Element exists in the DOM at the failure point but failed actionability checks`],
    };
  }

  for (let i = failedStep - 1; i >= 0; i--) {
    if (cache[i]) {
      const changes = computeChangesBetween(cache, i, failedStep);
      return {
        found: true,
        stepFound: i,
        lastKnownState: cache[i]!,
        disappearanceChanges: changes,
      };
    }
  }
  return { found: false };
}

function findNodeByLocator(node: DomNode, value: string, type?: string): DomNode | null {
  if (matchesLocator(node, value, type)) return node;
  for (const child of node.children) {
    const found = findNodeByLocator(child, value, type);
    if (found) return found;
  }
  return null;
}

function matchesLocator(node: DomNode, value: string, type?: string): boolean {
  switch (type) {
    case 'getByTestId':
      return node.attributes['data-testid'] === value;
    case 'getByRole':
      return node.attributes['role'] === value
        || node.attributes['aria-label'] === value
        || node.attributes['aria-roledescription'] === value;
    case 'getByLabel':
      return (node.attributes['aria-label'] === value)
        || (node.attributes['aria-labelledby'] === value)
        || (node.text?.includes(value) ?? false);
    case 'getByText':
      return node.text?.includes(value) ?? false;
    case 'getByPlaceholder':
      return node.attributes['placeholder'] === value;
    case 'getByTitle':
      return node.attributes['title'] === value;
    case 'getByAltText':
      return node.attributes['alt'] === value;
    default:
      if (value.startsWith('#')) return node.id === value.slice(1);
      if (value.startsWith('.')) return node.className?.includes(value.slice(1)) ?? false;
      return node.tag === value || node.id === value
        || node.attributes['data-testid'] === value
        || node.attributes['aria-label'] === value
        || node.attributes['name'] === value;
  }
}

function computeChangesBetween(
  cache: (DomNode | null)[],
  startStep: number,
  endStep: number,
): string[] {
  const changes: string[] = [];
  for (let step = startStep; step < endStep; step++) {
    const globalStep = step + 1;
    const nodeBefore = cache[step];
    const nodeAfter = cache[step + 1];

    if (nodeBefore && !nodeAfter) {
      changes.push(`Element removed from DOM at step ${globalStep}`);
    } else     if (nodeBefore && nodeAfter) {
      if (nodeBefore.className !== nodeAfter.className) {
        changes.push(`CSS class changed from "${nodeBefore.className}" to "${nodeAfter.className}" at step ${globalStep}`);
      }
      if (nodeBefore.text !== nodeAfter.text) {
        changes.push(`Text changed from "${nodeBefore.text}" to "${nodeAfter.text}" at step ${globalStep}`);
      }
      if (nodeBefore.visible && !nodeAfter.visible) {
        changes.push(`Element became hidden at step ${globalStep}`);
      }
      const beforeTestId = nodeBefore.attributes['data-testid'];
      const afterTestId = nodeAfter.attributes['data-testid'];
      if (beforeTestId !== afterTestId) {
        if (afterTestId === undefined) {
          changes.push(`data-testid removed (was "${beforeTestId}") at step ${globalStep}`);
        } else if (beforeTestId === undefined) {
          changes.push(`data-testid added ("${afterTestId}") at step ${globalStep}`);
        } else {
          changes.push(`data-testid changed from "${beforeTestId}" to "${afterTestId}" at step ${globalStep}`);
        }
      }
      const boolBefore = nodeBefore.booleanAttrs?.join(',') ?? '';
      const boolAfter = nodeAfter.booleanAttrs?.join(',') ?? '';
      if (boolBefore !== boolAfter) {
        changes.push(`Boolean attributes changed from [${boolBefore}] to [${boolAfter}] at step ${globalStep}`);
      }
    }
  }
  return changes;
}
