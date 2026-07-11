import type { DomNode } from '../collector/dom-snapshot.js';
import type { DiffResult } from '../analyzer/dom-diff.js';
import type { SelectorTrace } from '../analyzer/selector-tracer.js';
import type { Verdict } from '../analyzer/verdict-builder.js';
import type { MutationRecord } from '../collector/mutation-log.js';
import { renderVerdictHtml } from '../analyzer/verdict-builder.js';
import { escapeHtml } from '../escape.js';

export function generateHtmlReport(params: {
  testName: string;
  errorMessage: string;
  history: DomNode[];
  diffs: DiffResult[];
  trace?: SelectorTrace;
  verdict: Verdict;
  mutationLogs?: MutationRecord[][];
}): string {
  const { testName, errorMessage, history, diffs, verdict, mutationLogs } = params;

  const categoryColors: Record<string, string> = {
    'locator-not-found': '#6f42c1',
    'dom-disappeared': '#dc3545',
    'actionability': '#fd7e14',
    'network': '#17a2b8',
    'assertion': '#e83e8c',
    'runtime': '#6c757d',
    'unknown': '#6c757d',
  };
  const catColor = categoryColors[verdict.category] || '#6c757d';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Forensics Report — ${escapeHtml(testName)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f0f2f5; color: #1a1a2e; padding: 2rem; }
  .container { max-width: 960px; margin: 0 auto; }
  .header { background: linear-gradient(135deg, #1a1a2e, #16213e); color: white; padding: 2rem; border-radius: 12px; margin-bottom: 1.5rem; }
  .header h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
  .header .meta { opacity: 0.8; font-size: 0.9rem; }
  .verdict-box { background: #fff; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 2px 8px rgba(0,0,0,0.08); border-left: 4px solid ${catColor}; }
  .verdict-box h2 { font-size: 1.1rem; color: ${catColor}; margin-bottom: 0.75rem; }
  .verdict-box pre { white-space: pre-wrap; font-family: inherit; font-size: 0.95rem; line-height: 1.5; }
  .verdict-box .cat-badge { display: inline-block; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.7rem; font-weight: 600; color: white; background: ${catColor}; margin-left: 0.5rem; text-transform: uppercase; vertical-align: middle; }
  .section { background: #fff; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  .section h2 { font-size: 1.1rem; color: #1a1a2e; margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 2px solid #f0f2f5; }
  .timeline { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
  .step { display: inline-flex; align-items: center; justify-content: center; min-width: 2.5rem; height: 2.5rem; border-radius: 50%; background: #e9ecef; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: all 0.2s; }
  .step:hover { transform: scale(1.1); }
  .step.active { background: #0d6efd; color: white; }
  .step.failure { background: #dc3545; color: white; }
  .step.has-change { background: #ffc107; color: #1a1a2e; }
  .step-label { font-size: 0.7rem; color: #666; margin-top: 0.25rem; }
  .diff-list { list-style: none; }
  .diff-item { padding: 0.5rem 0.75rem; margin: 0.25rem 0; border-radius: 6px; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.85rem; }
  .diff-added { background: #d4edda; color: #155724; }
  .diff-removed { background: #f8d7da; color: #721c24; }
  .diff-changed { background: #fff3cd; color: #856404; }
  .diff-path { font-weight: 600; }
  .diff-detail { display: block; margin-left: 1rem; font-size: 0.8rem; opacity: 0.8; }
  .dom-tree { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.8rem; line-height: 1.6; background: #f8f9fa; padding: 1rem; border-radius: 8px; overflow-x: auto; }
  .dom-tree .node { padding-left: 1.5rem; }
  .dom-tree .tag { color: #0d6efd; }
  .dom-tree .attr { color: #6f42c1; }
  .dom-tree .text { color: #28a745; }
  .dom-tree .invisible { opacity: 0.4; text-decoration: line-through; }
  .error-box { background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 8px; padding: 1rem; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.85rem; white-space: pre-wrap; overflow-x: auto; }
  .step-detail { margin-top: 1rem; display: none; }
  .step-detail.visible { display: block; }
  .nav-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
  .nav-btn { padding: 0.5rem 1rem; border: 1px solid #dee2e6; border-radius: 6px; background: white; cursor: pointer; font-size: 0.9rem; }
  .nav-btn:hover { background: #e9ecef; }
  .badge { display: inline-block; padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.7rem; font-weight: 600; margin-left: 0.5rem; }
  .badge-change { background: #ffc107; color: #1a1a2e; }
  @media (max-width: 600px) { body { padding: 1rem; } .header { padding: 1rem; } }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>🔍 Playwright Forensics Report</h1>
    <div class="meta">Test: <strong>${escapeHtml(testName)}</strong> | Author: Roman Chovgun</div>
    <div class="meta">Snapshots: ${history.length} | Status: ❌ FAILED</div>
  </div>

  <div class="verdict-box">
    <h2>${verdict.icon} Verdict <span class="cat-badge">${verdict.category}</span></h2>
    <pre>${renderVerdictHtml(verdict)}</pre>
  </div>

  <div class="section">
    <h2>📋 Snapshot Timeline</h2>
    ${(() => {
      const displayLen = Math.min(history.length, 25);
      const offset = history.length > 25 ? history.length - 25 : 0;
      return (history.length > 25 ? '<p style="color:#999;font-size:0.85rem;margin-bottom:0.5rem;">⚠️ Only last 25 snapshots are shown below</p>' : '')
        + '<div class="timeline">'
        + Array.from({ length: displayLen }, (_, i) => {
            const realIdx = offset + i;
            let cls = 'step';
            if (realIdx === history.length - 1) cls += ' failure';
            return `<div class="${cls}" data-step="${i}" onclick="showStep(${i})">${realIdx}</div>`;
          }).join('\n      ')
        + '</div>';
    })()}
    <div class="step-detail visible" id="step-detail">
      <div class="nav-bar">
        <button class="nav-btn" onclick="prevStep()">← Previous</button>
        <span id="step-label">Step 0</span>
        <button class="nav-btn" onclick="nextStep()">Next →</button>
      </div>
      <div class="dom-tree" id="dom-tree"></div>
    </div>
  </div>

  <div class="section">
    <h2>🔄 DOM Changes (last 2 snapshots)</h2>
    ${diffs.length === 0 ? '<p style="color:#666">No changes between the last snapshots</p>' : `
    <ul class="diff-list">
      ${diffs.map(d => {
        const cls = d.type === 'added' ? 'diff-added' : d.type === 'removed' ? 'diff-removed' : 'diff-changed';
        const label = d.type === 'added' ? '➕ ADDED' : d.type === 'removed' ? '➖ REMOVED' : '✏️ CHANGED';
        return `<li class="diff-item ${cls}">
          <span class="diff-path">${label}</span> ${escapeHtml(d.path)}
          ${d.oldValue ? `<span class="diff-detail">was: ${escapeHtml(d.oldValue)}</span>` : ''}
          ${d.newValue ? `<span class="diff-detail">now: ${escapeHtml(d.newValue)}</span>` : ''}
        </li>`;
      }).join('\n      ')}
    </ul>`}
  </div>

  <div class="section">
    <h2>📝 Mutation Log</h2>
    ${!mutationLogs || mutationLogs.length === 0 ? '<p style="color:#666">Mutation logging was not enabled. Call <code>await forensics.startMutationLog()</code> to capture DOM mutations between snapshots.</p>' : `
    ${mutationLogs.map((batch, bi) => `
    <div style="margin-bottom:1rem;">
      <strong style="font-size:0.9rem;">Batch ${bi + 1}: ${batch.length} mutations</strong>
      <div style="font-family:'SF Mono','Fira Code',monospace;font-size:0.8rem;background:#f8f9fa;padding:0.75rem;border-radius:6px;margin-top:0.25rem;">
      ${batch.slice(0, 20).map(m => {
        let desc = `[${m.type}] <span style="color:#0d6efd">${escapeHtml(m.target)}</span>`;
        if (m.attributeName) desc += ` <span style="color:#6f42c1">${escapeHtml(m.attributeName)}</span>`;
        if (m.addedNodes > 0) desc += ` <span style="color:#28a745">+${m.addedNodes} nodes</span>`;
        if (m.removedNodes > 0) desc += ` <span style="color:#dc3545">-${m.removedNodes} nodes</span>`;
        return `<div>${desc}</div>`;
      }).join('\n      ')}
      ${batch.length > 20 ? `<div style="color:#666;margin-top:0.25rem;">... and ${batch.length - 20} more</div>` : ''}
      </div>
    </div>`).join('\n      ')}`}
  </div>

  <div class="section">
    <h2>💥 Error</h2>
    <div class="error-box">${escapeHtml(errorMessage)}</div>
  </div>
</div>

<script>
  // Only the last 25 snapshots are inlined to keep the HTML small
  const snapshots = ${JSON.stringify(history.length > 25 ? history.slice(-25) : history)};
  const totalSnapshotCount = ${history.length};
  const snapshotOffset = totalSnapshotCount > 25 ? totalSnapshotCount - 25 : 0;
  let currentStep = snapshots.length - 1;

  function showStep(i) {
    currentStep = i;
    document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
    document.querySelector('.step[data-step="' + i + '"]')?.classList.add('active');
    const realIdx = snapshotOffset + i;
    const isFailure = realIdx === totalSnapshotCount - 1;
    document.getElementById('step-label').textContent = 'Step ' + realIdx + (isFailure ? ' (failure point)' : '');
    document.getElementById('dom-tree').innerHTML = snapshots[i] ? renderDomNode(snapshots[i], 0) : '<em>No data</em>';
  }

  function prevStep() { if (currentStep > 0) showStep(currentStep - 1); }
  function nextStep() { if (currentStep < snapshots.length - 1) showStep(currentStep + 1); }

  function renderDomNode(node, depth) {
    if (!node) return '';
    const indent = '  '.repeat(depth);
    const invis = node.visible === false ? ' class="invisible"' : '';
    let attrs = '';
    if (node.attributes) for (const k of Object.keys(node.attributes)) {
      attrs += ' <span class="attr">' + esc(k) + '="' + esc(node.attributes[k]) + '"</span>';
    }
    const idStr = node.id ? ' <span class="attr">id="' + esc(node.id) + '"</span>' : '';
    const classStr = node.className ? ' <span class="attr">class="' + esc(node.className) + '"</span>' : '';
    const textStr = node.text ? ' <span class="text">' + esc(node.text) + '</span>' : '';
    let html = '<div class="node"' + invis + '>' + indent + '&lt;<span class="tag">' + esc(node.tag) + '</span>' + idStr + classStr + attrs + '&gt;' + textStr;
    if (node.children && node.children.length > 0) {
      html += '<br>';
      for (const c of node.children) html += renderDomNode(c, depth + 1) + '<br>';
      html += indent;
    }
    html += '&lt;/<span class="tag">' + esc(node.tag) + '</span>&gt;</div>';
    return html;
  }

  function esc(s) {
    if (typeof s !== 'string') return String(s || '');
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  showStep(currentStep);
</script>
</body>
</html>`;
}
