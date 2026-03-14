#!/usr/bin/env npx tsx
/**
 * Generates an interactive HTML visualization of the AGENT_PIPELINE.
 * Usage: npx tsx scripts/visualize-pipeline.ts
 * Output: pipeline-visualization.html (open in browser)
 */
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { AGENT_PIPELINE } from '../src/core/data/seeded-pipelines';

const pipeline = AGENT_PIPELINE;

// Build data structures for the HTML
const statusesJson = JSON.stringify(pipeline.statuses);
const transitionsJson = JSON.stringify(pipeline.transitions);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${pipeline.name} Pipeline</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; }

  .header { padding: 24px 32px; border-bottom: 1px solid #1e293b; display: flex; align-items: center; gap: 16px; }
  .header h1 { font-size: 20px; font-weight: 600; }
  .header .desc { color: #94a3b8; font-size: 14px; }

  .layout { display: flex; height: calc(100vh - 73px); }

  /* ── Left: Graph ── */
  .graph-panel { flex: 1; overflow: auto; position: relative; }
  .graph-container { padding: 40px; min-width: 900px; }

  /* ── Right: Sidebar ── */
  .sidebar { width: 380px; border-left: 1px solid #1e293b; overflow-y: auto; display: flex; flex-direction: column; }
  .sidebar-header { padding: 16px 20px; border-bottom: 1px solid #1e293b; font-weight: 600; font-size: 14px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
  .sidebar-body { padding: 16px 20px; flex: 1; overflow-y: auto; }
  .sidebar-empty { color: #64748b; font-size: 14px; padding: 20px 0; text-align: center; }

  /* ── Status nodes ── */
  .status-row { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
  .status-row.category-label { margin-top: 24px; margin-bottom: 12px; }
  .category-title { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #64748b; font-weight: 600; }

  .status-node {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 10px 18px; border-radius: 10px;
    cursor: pointer; transition: all 0.15s; position: relative;
    border: 2px solid transparent; user-select: none;
    font-size: 14px; font-weight: 500;
  }
  .status-node:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
  .status-node.selected { border-color: #fff; box-shadow: 0 0 0 3px rgba(255,255,255,0.15); }
  .status-node .dot { width: 8px; height: 8px; border-radius: 50%; }

  /* ── Transition cards ── */
  .transition-group { margin-bottom: 20px; }
  .transition-group-title { font-size: 12px; font-weight: 600; color: #94a3b8; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }

  .transition-card {
    background: #1e293b; border-radius: 8px; padding: 12px 14px;
    margin-bottom: 6px; font-size: 13px; cursor: pointer;
    border: 1px solid #334155; transition: all 0.15s;
  }
  .transition-card:hover { border-color: #475569; background: #253349; }
  .transition-card.highlighted { border-color: #60a5fa; background: #1e3a5f; }

  .tc-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .tc-arrow { display: flex; align-items: center; gap: 6px; font-weight: 500; }
  .tc-arrow .arr { color: #64748b; }
  .tc-from { color: #94a3b8; }
  .tc-to { color: #e2e8f0; }
  .tc-label { color: #60a5fa; font-size: 12px; margin-left: auto; }
  .tc-outcome { color: #fbbf24; font-size: 12px; margin-left: auto; }

  .tc-details { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  .badge {
    display: inline-flex; align-items: center; padding: 2px 8px;
    border-radius: 4px; font-size: 11px; font-weight: 500;
  }
  .badge-trigger-manual { background: #1e3a5f; color: #60a5fa; }
  .badge-trigger-agent { background: #3b1f1f; color: #f87171; }
  .badge-trigger-system { background: #1f3b2b; color: #4ade80; }
  .badge-guard { background: #312e3b; color: #c084fc; }
  .badge-hook { background: #2d3028; color: #a3e635; }
  .badge-hook-required { background: #3b2020; color: #fca5a5; }
  .badge-hook-fire { background: #1a2e1a; color: #86efac; }

  /* ── Graph edges (SVG) ── */
  .graph-svg { position: absolute; top: 0; left: 0; pointer-events: none; }
  .edge { fill: none; stroke: #334155; stroke-width: 1.5; }
  .edge.highlighted { stroke: #60a5fa; stroke-width: 2.5; }
  .edge.highlighted-out { stroke: #4ade80; stroke-width: 2; }
  .edge.highlighted-in { stroke: #f87171; stroke-width: 2; }
  .edge-arrow { fill: #334155; }
  .edge-arrow.highlighted { fill: #60a5fa; }
  .edge-arrow.highlighted-out { fill: #4ade80; }
  .edge-arrow.highlighted-in { fill: #f87171; }

  /* ── Filter bar ── */
  .filters { padding: 12px 20px; border-bottom: 1px solid #1e293b; display: flex; gap: 6px; flex-wrap: wrap; }
  .filter-btn {
    padding: 4px 12px; border-radius: 6px; border: 1px solid #334155;
    background: transparent; color: #94a3b8; font-size: 12px; cursor: pointer;
    transition: all 0.15s;
  }
  .filter-btn:hover { border-color: #475569; color: #e2e8f0; }
  .filter-btn.active { background: #1e3a5f; border-color: #60a5fa; color: #60a5fa; }

  /* ── Legend ── */
  .legend { padding: 12px 20px; border-top: 1px solid #1e293b; display: flex; flex-wrap: wrap; gap: 12px; font-size: 11px; color: #64748b; }
  .legend-item { display: flex; align-items: center; gap: 4px; }
  .legend-swatch { width: 12px; height: 12px; border-radius: 3px; }
</style>
</head>
<body>
<div class="header">
  <h1>${pipeline.name} Pipeline</h1>
  <span class="desc">${pipeline.description}</span>
</div>
<div class="layout">
  <div class="graph-panel" id="graphPanel">
    <svg class="graph-svg" id="edgeSvg"></svg>
    <div class="graph-container" id="graphContainer"></div>
  </div>
  <div class="sidebar">
    <div class="filters" id="filters"></div>
    <div class="sidebar-header" id="sidebarHeader">Transitions</div>
    <div class="sidebar-body" id="sidebarBody">
      <div class="sidebar-empty">Click a status node to see its transitions</div>
    </div>
    <div class="legend">
      <div class="legend-item"><div class="legend-swatch" style="background:#60a5fa"></div> Manual</div>
      <div class="legend-item"><div class="legend-swatch" style="background:#f87171"></div> Agent</div>
      <div class="legend-item"><div class="legend-swatch" style="background:#4ade80"></div> System</div>
      <div class="legend-item"><div class="legend-swatch" style="background:#c084fc"></div> Guard</div>
      <div class="legend-item"><div class="legend-swatch" style="background:#a3e635"></div> Hook</div>
    </div>
  </div>
</div>

<script>
const statuses = ${statusesJson};
const transitions = ${transitionsJson};

const categoryOrder = ['ready', 'agent_running', 'human_review', 'waiting_for_input', 'terminal'];
const categoryLabels = {
  ready: 'Ready', agent_running: 'Agent Running', human_review: 'Human Review',
  waiting_for_input: 'Waiting', terminal: 'Terminal',
};

// Group statuses by category
const byCategory = {};
for (const s of statuses) {
  const cat = s.category || 'other';
  if (!byCategory[cat]) byCategory[cat] = [];
  byCategory[cat].push(s);
}

// Render graph nodes
const graphContainer = document.getElementById('graphContainer');
const nodeElements = {};

for (const cat of categoryOrder) {
  const items = byCategory[cat];
  if (!items) continue;

  const catRow = document.createElement('div');
  catRow.className = 'status-row category-label';
  catRow.innerHTML = '<span class="category-title">' + categoryLabels[cat] + '</span>';
  graphContainer.appendChild(catRow);

  const row = document.createElement('div');
  row.className = 'status-row';
  row.style.flexWrap = 'wrap';
  row.style.gap = '10px';

  for (const s of items) {
    const node = document.createElement('div');
    node.className = 'status-node';
    node.style.background = hexToRgba(s.color, 0.18);
    node.style.color = s.color;
    node.dataset.status = s.name;
    node.innerHTML = '<span class="dot" style="background:' + s.color + '"></span>' + s.label;
    node.addEventListener('click', () => selectStatus(s.name));
    row.appendChild(node);
    nodeElements[s.name] = node;
  }
  graphContainer.appendChild(row);
}

// State
let selectedStatus = null;
let activeFilters = new Set(['manual', 'agent', 'system']);

// Render filter buttons
const filtersEl = document.getElementById('filters');
for (const trigger of ['manual', 'agent', 'system']) {
  const btn = document.createElement('button');
  btn.className = 'filter-btn active';
  btn.textContent = trigger;
  btn.dataset.trigger = trigger;
  btn.addEventListener('click', () => {
    if (activeFilters.has(trigger)) { activeFilters.delete(trigger); btn.classList.remove('active'); }
    else { activeFilters.add(trigger); btn.classList.add('active'); }
    if (selectedStatus) renderSidebar(selectedStatus);
  });
  filtersEl.appendChild(btn);
}

function selectStatus(name) {
  // Toggle
  if (selectedStatus === name) { selectedStatus = null; clearSelection(); return; }
  selectedStatus = name;

  // Highlight node
  Object.values(nodeElements).forEach(n => n.classList.remove('selected'));
  if (nodeElements[name]) nodeElements[name].classList.add('selected');

  renderSidebar(name);
  renderEdges(name);
}

function clearSelection() {
  selectedStatus = null;
  Object.values(nodeElements).forEach(n => n.classList.remove('selected'));
  document.getElementById('sidebarHeader').textContent = 'Transitions';
  document.getElementById('sidebarBody').innerHTML = '<div class="sidebar-empty">Click a status node to see its transitions</div>';
  clearEdges();
}

function renderSidebar(status) {
  const outgoing = transitions.filter(t => (t.from === status || t.from === '*') && activeFilters.has(t.trigger));
  const incoming = transitions.filter(t => t.to === status && t.from !== '*' && activeFilters.has(t.trigger));

  const statusObj = statuses.find(s => s.name === status);
  document.getElementById('sidebarHeader').textContent = (statusObj ? statusObj.label : status) + ' — ' + (outgoing.length + incoming.length) + ' transitions';

  const body = document.getElementById('sidebarBody');
  body.innerHTML = '';

  if (outgoing.length > 0) {
    body.appendChild(makeGroup('Outgoing', outgoing, status, 'out'));
  }
  if (incoming.length > 0) {
    body.appendChild(makeGroup('Incoming', incoming, status, 'in'));
  }
  if (outgoing.length === 0 && incoming.length === 0) {
    body.innerHTML = '<div class="sidebar-empty">No transitions match the active filters</div>';
  }
}

function makeGroup(title, items, selectedStatus, direction) {
  const group = document.createElement('div');
  group.className = 'transition-group';
  group.innerHTML = '<div class="transition-group-title">' + title + ' (' + items.length + ')</div>';
  for (const t of items) {
    const card = document.createElement('div');
    card.className = 'transition-card';

    const fromLabel = t.from === '*' ? 'Any' : statusLabel(t.from);
    const toLabel = statusLabel(t.to);

    let header = '<div class="tc-header"><div class="tc-arrow">';
    header += '<span class="tc-from">' + fromLabel + '</span>';
    header += '<span class="arr">→</span>';
    header += '<span class="tc-to">' + toLabel + '</span>';
    header += '</div>';
    if (t.label) header += '<span class="tc-label">' + t.label + '</span>';
    if (t.agentOutcome) header += '<span class="tc-outcome">' + t.agentOutcome + '</span>';
    header += '</div>';

    let details = '<div class="tc-details">';
    details += '<span class="badge badge-trigger-' + t.trigger + '">' + t.trigger + '</span>';
    if (t.guards) {
      for (const g of t.guards) {
        let guardText = g.name;
        if (g.params) guardText += '(' + Object.values(g.params).join(',') + ')';
        details += '<span class="badge badge-guard">' + guardText + '</span>';
      }
    }
    if (t.hooks) {
      for (const h of t.hooks) {
        const cls = h.policy === 'required' ? 'badge-hook-required' : h.policy === 'fire_and_forget' ? 'badge-hook-fire' : 'badge-hook';
        let hookText = h.name;
        if (h.params && h.params.agentType) hookText += '(' + h.params.agentType + ')';
        details += '<span class="badge ' + cls + '">' + hookText + '</span>';
      }
    }
    details += '</div>';

    card.innerHTML = header + details;

    // Hover to highlight the other end
    const otherStatus = direction === 'out' ? t.to : t.from;
    card.addEventListener('mouseenter', () => {
      if (nodeElements[otherStatus]) nodeElements[otherStatus].style.boxShadow = '0 0 0 3px rgba(96,165,250,0.4)';
    });
    card.addEventListener('mouseleave', () => {
      if (nodeElements[otherStatus]) nodeElements[otherStatus].style.boxShadow = '';
    });

    group.appendChild(card);
  }
  return group;
}

function statusLabel(name) {
  const s = statuses.find(s => s.name === name);
  return s ? s.label : name;
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

// ── Edge rendering ─────────────────────────────────────────────────
function clearEdges() {
  document.getElementById('edgeSvg').innerHTML = '';
}

function renderEdges(status) {
  const svg = document.getElementById('edgeSvg');
  const panel = document.getElementById('graphPanel');
  svg.innerHTML = '';
  svg.setAttribute('width', panel.scrollWidth);
  svg.setAttribute('height', panel.scrollHeight);

  const outgoing = transitions.filter(t => (t.from === status || t.from === '*') && t.to !== status);
  const incoming = transitions.filter(t => t.to === status && t.from !== status && t.from !== '*');

  const drawnPairs = new Set();

  for (const t of outgoing) {
    const key = t.from + '->' + t.to;
    if (drawnPairs.has(key)) continue;
    drawnPairs.add(key);
    drawEdge(svg, panel, status, t.to, 'highlighted-out');
  }
  for (const t of incoming) {
    const key = t.from + '->' + t.to;
    if (drawnPairs.has(key)) continue;
    drawnPairs.add(key);
    drawEdge(svg, panel, t.from, status, 'highlighted-in');
  }
}

function drawEdge(svg, panel, fromStatus, toStatus, cls) {
  const fromEl = nodeElements[fromStatus];
  const toEl = nodeElements[toStatus];
  if (!fromEl || !toEl) return;

  const panelRect = panel.getBoundingClientRect();
  const scrollLeft = panel.scrollLeft;
  const scrollTop = panel.scrollTop;

  const fromRect = fromEl.getBoundingClientRect();
  const toRect = toEl.getBoundingClientRect();

  const x1 = fromRect.left + fromRect.width / 2 - panelRect.left + scrollLeft;
  const y1 = fromRect.top + fromRect.height / 2 - panelRect.top + scrollTop;
  const x2 = toRect.left + toRect.width / 2 - panelRect.left + scrollLeft;
  const y2 = toRect.top + toRect.height / 2 - panelRect.top + scrollTop;

  // Curved path
  const dx = x2 - x1;
  const dy = y2 - y1;
  const cx = (x1 + x2) / 2 + dy * 0.15;
  const cy = (y1 + y2) / 2 - dx * 0.15;

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M ' + x1 + ' ' + y1 + ' Q ' + cx + ' ' + cy + ' ' + x2 + ' ' + y2);
  path.setAttribute('class', 'edge ' + cls);
  svg.appendChild(path);

  // Arrowhead
  const t = 0.92;
  const ax = (1-t)*(1-t)*x1 + 2*(1-t)*t*cx + t*t*x2;
  const ay = (1-t)*(1-t)*y1 + 2*(1-t)*t*cy + t*t*y2;
  const tdx = 2*(1-t)*(cx-x1) + 2*t*(x2-cx);
  const tdy = 2*(1-t)*(cy-y1) + 2*t*(y2-cy);
  const len = Math.sqrt(tdx*tdx + tdy*tdy);
  const ux = tdx/len, uy = tdy/len;
  const px = -uy, py = ux;
  const arrowSize = 8;

  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  const points = [
    (ax + ux * arrowSize) + ',' + (ay + uy * arrowSize),
    (ax + px * arrowSize * 0.5) + ',' + (ay + py * arrowSize * 0.5),
    (ax - px * arrowSize * 0.5) + ',' + (ay - py * arrowSize * 0.5),
  ].join(' ');
  arrow.setAttribute('points', points);
  arrow.setAttribute('class', 'edge-arrow ' + cls);
  svg.appendChild(arrow);
}

// Redraw edges on scroll/resize
const graphPanel = document.getElementById('graphPanel');
graphPanel.addEventListener('scroll', () => { if (selectedStatus) renderEdges(selectedStatus); });
window.addEventListener('resize', () => { if (selectedStatus) renderEdges(selectedStatus); });
</script>
</body>
</html>`;

const outPath = resolve(process.cwd(), 'pipeline-visualization.html');
writeFileSync(outPath, html);
console.log(`✓ Written to ${outPath} — open in browser`);
