import type { DomNode } from '../collector/dom-snapshot.js';

export interface DiffResult {
  type: 'added' | 'removed' | 'changed';
  path: string;
  oldValue?: string;
  newValue?: string;
}

export function diffDomTrees(before: DomNode, after: DomNode): DiffResult[] {
  const changes: DiffResult[] = [];
  computeDiff(before, after, '', changes);
  return changes;
}

function nodeKey(node: DomNode, index: number): string {
  if (node.id) return `id:${node.id}`;
  const testId = node.attributes['data-testid'];
  if (testId) return `testid:${testId}`;
  return `${node.tag}:${node.text ?? ''}@${index}`;
}

function computeDiff(
  before: DomNode | undefined,
  after: DomNode | undefined,
  path: string,
  changes: DiffResult[],
): void {
  if (!before && after) {
    changes.push({ type: 'added', path, newValue: after.tag });
    return;
  }
  if (before && !after) {
    changes.push({ type: 'removed', path, oldValue: before.tag });
    return;
  }
  if (!before || !after) return;

  const currentPath = path ? `${path}/${after.tag}${nodeSuffix(after)}` : `/${after.tag}${nodeSuffix(after)}`;

  if (before.className !== after.className) {
    changes.push({
      type: 'changed',
      path: currentPath,
      oldValue: before.className,
      newValue: after.className,
    });
  }

  if (before.text !== after.text) {
    changes.push({
      type: 'changed',
      path: currentPath,
      oldValue: before.text,
      newValue: after.text,
    });
  }

  if (before.visible !== after.visible) {
    changes.push({
      type: 'changed',
      path: currentPath,
      oldValue: `visible=${before.visible}`,
      newValue: `visible=${after.visible}`,
    });
  }

  const boolBefore = before.booleanAttrs?.join(',') ?? '';
  const boolAfter = after.booleanAttrs?.join(',') ?? '';
  if (boolBefore !== boolAfter) {
    changes.push({
      type: 'changed',
      path: currentPath,
      oldValue: boolBefore ? `[${boolBefore}]` : '(none)',
      newValue: boolAfter ? `[${boolAfter}]` : '(none)',
    });
  }

  // Diff full attribute map (excluding data-testid which is tracked by key identity)
  const beforeAttrs = { ...before.attributes };
  const afterAttrs = { ...after.attributes };
  delete beforeAttrs['data-testid'];
  delete afterAttrs['data-testid'];
  const allAttrKeys = new Set([...Object.keys(beforeAttrs), ...Object.keys(afterAttrs)]);
  for (const k of allAttrKeys) {
    if (beforeAttrs[k] !== afterAttrs[k]) {
      changes.push({
        type: 'changed',
        path: currentPath,
        oldValue: beforeAttrs[k] !== undefined ? `${k}="${beforeAttrs[k]}"` : undefined,
        newValue: afterAttrs[k] !== undefined ? `${k}="${afterAttrs[k]}"` : undefined,
      });
    }
  }

  const beforeMap = new Map<string, DomNode>();
  before.children.forEach((child, i) => {
    const key = nodeKey(child, i);
    if (!beforeMap.has(key)) beforeMap.set(key, child);
  });

  const afterMap = new Map<string, DomNode>();
  after.children.forEach((child, i) => {
    const key = nodeKey(child, i);
    if (!afterMap.has(key)) afterMap.set(key, child);
  });

  const allKeys = new Set([...beforeMap.keys(), ...afterMap.keys()]);

  for (const key of allKeys) {
    const beforeChild = beforeMap.get(key);
    const afterChild = afterMap.get(key);
    computeDiff(beforeChild, afterChild, currentPath, changes);
  }
}

function nodeSuffix(node: DomNode): string {
  if (node.id) return `#${node.id}`;
  if (node.className) {
    const cls = node.className.trim().split(/\s+/).slice(0, 2).join('.');
    if (cls) return `.${cls}`;
  }
  return '';
}
