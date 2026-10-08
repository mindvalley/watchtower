'use strict';

// Which fields a group of findings has, and the order to show them in.
// Read by the report page, the CSV export and the PDF export, so they agree.

// Wrapped: classic <script> tags share one global lexical scope.
(function attachFindingsColumns() {

// Ordered. A field not named here still appears, appended after these.
const FIELD_ORDER = ['pillar', 'sub', 'file', 'path', 'fileA', 'fileB', 'line', 'lines', 'scope', 'rule', 'id', 'package', 'installed', 'fixed', 'severity', 'bucket', 'type', 'undescribed', 'stack', 'status', 'rung', 'cc', 'allowed_reason', 'evidence'];

// Empty arrays count as absent, so `evidence: []` adds no column.
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

// Arrays are joined; `evidence` is a list and a cell is not.
function cellText(v) {
  if (Array.isArray(v)) return v.join('; ');
  return String(v == null ? '' : v);
}

// `findings-<system>-<date>.<ext>`, dated by the scan rather than by today, so
// two downloads of one scan are the same file.
function fileName(systemKey, generatedAt, ext) {
  const day = String(generatedAt || '').slice(0, 10);
  const safe = String(systemKey || 'system').replace(/[^A-Za-z0-9._-]/g, '-');
  const stem = day ? `findings-${safe}-${day}` : `findings-${safe}`;
  return `${stem}.${ext}`;
}

const BUCKET_RANK = ['prod', 'dev', 'transitive'];
const SEVERITY_RANK = ['critical', 'high', 'medium', 'low'];

function rank(order, value) {
  const i = order.indexOf(value);
  return i === -1 ? order.length : i;
}

// Dependency CVEs: prod before dev before transitive, then critical first.
// Findings without a bucket keep their order.
function orderItems(items) {
  if (!items.some((it) => it && it.bucket)) return items;
  return [...items].sort((a, b) => (rank(BUCKET_RANK, a.bucket) - rank(BUCKET_RANK, b.bucket))
    || (rank(SEVERITY_RANK, a.severity) - rank(SEVERITY_RANK, b.severity)));
}

const api = { FIELD_ORDER, itemColumns, hasValue, cellText, fileName, orderItems };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.FindingsColumns = api;

}());
