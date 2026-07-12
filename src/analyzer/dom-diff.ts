import type { DomNode } from '../collector/dom-snapshot.js';

export interface DiffResult {
  type: 'added' | 'removed' | 'changed' | 'moved';
  path: string;
  oldValue?: string;
  newValue?: string;
  confidence?: 'confirmed' | 'likely' | 'inferred';
}

export function diffDomTrees(before: DomNode, after: DomNode): DiffResult[] {
  const changes: DiffResult[] = [];
  computeDiff(before, after, '', changes);
  return changes;
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

  const beforeText = before.directText ?? before.text;
  const afterText = after.directText ?? after.text;
  if (beforeText !== afterText) {
    changes.push({
      type: 'changed',
      path: currentPath,
      oldValue: beforeText,
      newValue: afterText,
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

  // Attribute identity changes are evidence too; matching no longer depends solely on test id.
  const beforeAttrs = { ...before.attributes };
  const afterAttrs = { ...after.attributes };
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

  const matches = matchChildren(before.children, after.children);
  for (const match of matches) {
    if (match.beforeIndex === undefined) {
      computeDiff(undefined, after.children[match.afterIndex!], currentPath, changes);
      continue;
    }
    if (match.afterIndex === undefined) {
      computeDiff(before.children[match.beforeIndex], undefined, currentPath, changes);
      continue;
    }
    const beforeChild = before.children[match.beforeIndex];
    const afterChild = after.children[match.afterIndex];
    computeDiff(beforeChild, afterChild, currentPath, changes);
    if (match.beforeIndex !== match.afterIndex && match.confidence !== 'inferred') {
      changes.push({
        type: 'moved',
        path: `${currentPath}/${afterChild.tag}${nodeSuffix(afterChild)}`,
        oldValue: `index=${match.beforeIndex}`,
        newValue: `index=${match.afterIndex}`,
        confidence: match.confidence,
      });
    }
  }
}

interface ChildMatch {
  beforeIndex?: number;
  afterIndex?: number;
  confidence: 'confirmed' | 'likely' | 'inferred';
}

function scorePair(before: DomNode, after: DomNode, beforeIndex: number, afterIndex: number): number {
  if (before.tag !== after.tag) return -1;
  if (before.id && before.id === after.id) return 100;
  const beforeTestId = before.attributes['data-testid'];
  const afterTestId = after.attributes['data-testid'];
  if (beforeTestId && beforeTestId === afterTestId) return 95;
  if (before.structuralId && before.structuralId === after.structuralId) return 90;
  if (before.path && before.path === after.path) return 80;
  if (before.accessibleName && before.accessibleName === after.accessibleName) return 65;
  const beforeText = before.directText ?? before.text;
  const afterText = after.directText ?? after.text;
  if (beforeText && beforeText === afterText) return 55;
  if (beforeIndex === afterIndex) return 20;
  return 10;
}

function matchChildren(before: DomNode[], after: DomNode[]): ChildMatch[] {
  const candidates: { beforeIndex: number; afterIndex: number; score: number }[] = [];
  before.forEach((left, beforeIndex) => after.forEach((right, afterIndex) => {
    const score = scorePair(left, right, beforeIndex, afterIndex);
    if (score >= 0) candidates.push({ beforeIndex, afterIndex, score });
  }));
  candidates.sort((a, b) => b.score - a.score);
  const usedBefore = new Set<number>();
  const usedAfter = new Set<number>();
  const result: ChildMatch[] = [];
  for (const candidate of candidates) {
    if (usedBefore.has(candidate.beforeIndex) || usedAfter.has(candidate.afterIndex)) continue;
    usedBefore.add(candidate.beforeIndex);
    usedAfter.add(candidate.afterIndex);
    result.push({
      beforeIndex: candidate.beforeIndex,
      afterIndex: candidate.afterIndex,
      confidence: candidate.score >= 90 ? 'confirmed' : candidate.score >= 50 ? 'likely' : 'inferred',
    });
  }
  before.forEach((_, index) => {
    if (!usedBefore.has(index)) result.push({ beforeIndex: index, confidence: 'confirmed' });
  });
  after.forEach((_, index) => {
    if (!usedAfter.has(index)) result.push({ afterIndex: index, confidence: 'confirmed' });
  });
  return result;
}

function nodeSuffix(node: DomNode): string {
  if (node.id) return `#${node.id}`;
  if (node.className) {
    const cls = node.className.trim().split(/\s+/).slice(0, 2).join('.');
    if (cls) return `.${cls}`;
  }
  return '';
}
