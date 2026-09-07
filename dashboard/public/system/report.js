'use strict';
// Renders findings-<system>.json grouped criterion -> sub-metric -> disposition.
// Location tables; deep-linkable per criterion (#c<key>). No secret values are
// ever present in the data (guaranteed by build-findings-data.js).

const REPORT_CRITERIA = [
  { key: '2', label: 'Documented APIs' },
  { key: '4', label: 'Observable State' },
  { key: '6', label: 'Test Coverage' },
  { key: '7', label: 'Deployment Safety' },
  { key: '8', label: 'Codebase Simplicity' },
  { key: '9', label: 'Security Posture' },
];

// Ordered, human-friendly columns for whichever fields an item carries.
const FIELD_ORDER = ['pillar', 'sub', 'file', 'path', 'fileA', 'fileB', 'line', 'lines', 'scope', 'rule', 'id', 'package', 'installed', 'fixed', 'severity', 'bucket', 'type', 'undescribed', 'stack', 'status', 'rung', 'cc', 'allowed_reason', 'evidence'];

// A field is "present" if any item carries a non-empty value for it. Empty arrays
// (e.g. evidence: []) count as absent so they don't render a blank column.
function hasValue(v) {
  if (v == null || v === '') return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
}

function itemColumns(items) {
  const present = new Set();
  items.forEach((it) => Object.keys(it).forEach((k) => { if (hasValue(it[k])) present.add(k); }));
  return FIELD_ORDER.filter((k) => present.has(k)).concat([...present].filter((k) => !FIELD_ORDER.includes(k)));
}

function cell(v) {
  if (Array.isArray(v)) return v.join(', ');
  return String(v == null ? '' : v);
}

// Escape dynamic values before HTML interpolation. Findings data includes paths
// and identifiers from scanned repos (incl. external/cross-org) that can contain
// HTML metacharacters — never inject raw into innerHTML.
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[m]));
}

// "(allowed)" alone reads as a category of finding rather than a statement about
// the score. Spelling it out is the difference between a reader assuming these
// still count and knowing they do not.
const DISPOSITION_NOTE = { allowed: 'allowed — not counted toward the score' };

function renderGroup(g) {
  const items = (g.items || []).filter(Boolean);
  if (!items.length) return '';
  const allowed = g.disposition === 'allowed';
  const cols = itemColumns(items);
  const head = cols.map((c) => `<th style="text-align:left;padding:4px 10px;color:var(--text-muted);font-weight:600">${esc(c)}</th>`).join('');
  const rows = items.map((it) => `<tr>${cols.map((c) => `<td style="padding:4px 10px;font-family:var(--font-mono);font-size:var(--fs-xs)">${esc(cell(it[c]))}</td>`).join('')}</tr>`).join('');
  const dispText = g.disposition ? (DISPOSITION_NOTE[g.disposition] || g.disposition) : '';
  const disp = dispText ? ` <span style="color:var(--text-muted);font-size:var(--fs-micro)">(${esc(dispText)})</span>` : '';
  // Muted heading and a dashed edge, so an allowed block reads as settled at a
  // glance rather than only on reading the label.
  const headingColour = allowed ? 'var(--text-muted)' : 'var(--text)';
  const panelStyle = allowed ? 'overflow-x:auto;border-style:dashed;opacity:0.75' : 'overflow-x:auto';
  return `
    <div style="margin:10px 0">
      <div style="font-size:var(--fs-xs);font-weight:600;color:${headingColour};margin-bottom:4px">${esc(g.label || g.sub)}${disp} · ${items.length}</div>
      <div class="panel" style="${panelStyle}"><table style="border-collapse:collapse;width:100%"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
}

async function initReport(systemKey) {
  const back = document.getElementById('back-link');
  if (back) back.href = `/system/${systemKey}`;
  const body = document.getElementById('report-body');

  // Set before the load so the page is identifiable while it waits, and still
  // identifiable if the load fails.
  document.getElementById('report-title').textContent = `${systemKey} — findings report`;

  // These are the heaviest files on the site — 1.2 MB at the top end.
  let data = null;
  try {
    // A 404 is a real answer, not a failure: some systems have no located
    // findings, and that renders as its own message below. Only a transport
    // error reaches the catch, which is a distinction the previous version
    // collapsed — it turned a dead request into "no findings for this system".
    data = await Loading.withLoading(
      body,
      'Loading findings…',
      () => fetch(`/data/findings-${systemKey}.json`).then((r) => (r.ok ? r.json() : null)),
    );
  } catch (e) {
    console.error('Failed to load findings:', e);
    return;
  }

  document.getElementById('report-date').textContent = (data && data.generated_at) || '';
  if (!data || !data.criteria) {
    body.innerHTML = '<div class="panel" style="padding:20px;color:var(--text-muted)">No located findings for this system.</div>';
    return;
  }
  const sections = REPORT_CRITERIA.map(({ key, label }) => {
    const c = data.criteria[key];
    if (!c || !(c.groups || []).length) return '';
    const groups = c.groups.map(renderGroup).join('');
    if (!groups.trim()) return '';
    return `
      <section class="section" id="c${key}">
        <div class="section-label">${esc(c.label || label)}</div>
        ${groups}
      </section>`;
  }).filter(Boolean).join('');
  body.innerHTML = sections || '<div class="panel" style="padding:20px;color:var(--text-muted)">No located findings for this system.</div>';

  if (location.hash) { const el = document.querySelector(location.hash); if (el) el.scrollIntoView(); }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { itemColumns, renderGroup, esc };
}
