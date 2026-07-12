import type { DomNode } from '../collector/dom-snapshot.js';
import { queryLocator } from './locator/engine.js';
import type { LocatorExpression } from './locator/types.js';

export interface SelectorTrace {
  found: boolean;
  stepFound?: number;
  lastKnownState?: DomNode;
  disappearanceChanges?: string[];
  confidence?: 'confirmed' | 'likely' | 'insufficient-evidence';
  limitations?: string[];
}

export function traceSelector(
  locatorValue: string | LocatorExpression,
  snapshotHistory: DomNode[],
  failedStep: number,
  locatorType?: string,
): SelectorTrace {
  const expression = typeof locatorValue === 'string'
    ? legacyExpression(locatorValue, locatorType)
    : locatorValue;
  const results = snapshotHistory.map(snapshot => queryLocator(snapshot, expression));
  const cache = results.map(result => result.nodes[0] ?? null);
  const evidence = results[failedStep];

  const matchAtFailure = cache[failedStep];
  if (matchAtFailure) {
    return {
      found: true,
      stepFound: failedStep,
      lastKnownState: matchAtFailure,
      disappearanceChanges: [`Element exists in the DOM at the failure point but failed actionability checks`],
      confidence: evidence.confidence,
      limitations: evidence.limitations,
    };
  }

  for (let i = failedStep - 1; i >= 0; i--) {
    if (cache[i]) {
      const changes = computeChangesBetween(cache, snapshotHistory, i, failedStep);
      return {
        found: true,
        stepFound: i,
        lastKnownState: cache[i]!,
        disappearanceChanges: changes,
        confidence: results[i].confidence,
        limitations: results[i].limitations,
      };
    }
  }
  return {
    found: false,
    confidence: evidence?.confidence ?? 'insufficient-evidence',
    limitations: evidence?.limitations,
  };
}

function legacyExpression(value: string, type?: string): LocatorExpression {
  const matcher = { value };
  switch (type) {
    case 'getByTestId': return { source: value, steps: [{ kind: 'testId', matcher }] };
    case 'getByRole': return { source: value, steps: [{ kind: 'role', role: value }] };
    case 'getByLabel': return { source: value, steps: [{ kind: 'label', matcher }] };
    case 'getByText': return { source: value, steps: [{ kind: 'text', matcher }] };
    case 'getByPlaceholder': return { source: value, steps: [{ kind: 'placeholder', matcher }] };
    case 'getByTitle': return { source: value, steps: [{ kind: 'title', matcher }] };
    case 'getByAltText': return { source: value, steps: [{ kind: 'altText', matcher }] };
    default: return { source: value, steps: [{ kind: 'testId', matcher }] };
  }
}

function computeChangesBetween(
  cache: (DomNode | null)[],
  snapshots: DomNode[],
  startStep: number,
  endStep: number,
): string[] {
  const changes: string[] = [];
  for (let step = startStep; step < endStep; step++) {
    const globalStep = step + 1;
    const nodeBefore = cache[step];
    const nodeAfter = cache[step + 1] ?? (nodeBefore ? findSameNode(snapshots[step + 1], nodeBefore) : null);

    if (nodeBefore && !nodeAfter) {
      changes.push(`Element removed from DOM at step ${globalStep}`);
    } else     if (nodeBefore && nodeAfter) {
      if (nodeBefore.className !== nodeAfter.className) {
        changes.push(`CSS class changed from "${nodeBefore.className}" to "${nodeAfter.className}" at step ${globalStep}`);
      }
      const beforeText = nodeBefore.directText ?? nodeBefore.text;
      const afterText = nodeAfter.directText ?? nodeAfter.text;
      if (beforeText !== afterText) {
        changes.push(`Text changed from "${beforeText}" to "${afterText}" at step ${globalStep}`);
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

function findSameNode(root: DomNode, before: DomNode): DomNode | null {
  const nodes: DomNode[] = [root];
  const sameTag: DomNode[] = [];
  while (nodes.length) {
    const node = nodes.shift()!;
    if (node.tag === before.tag) sameTag.push(node);
    if (
      (before.structuralId && node.structuralId === before.structuralId)
      || (before.id && node.id === before.id)
      || (before.path && node.path === before.path && node.tag === before.tag)
    ) return node;
    nodes.push(...node.children);
  }
  return sameTag.length === 1 ? sameTag[0] : null;
}
