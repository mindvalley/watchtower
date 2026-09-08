'use strict';

// Which fields a group of findings has, and the order to show them in.
//
// Three things read this: the report page draws a table per group, the CSV
// export flattens every group into one table, and the PDF redraws the report.
// They must agree about column order or the same report looks like three
// different documents. It lived in the report page first and was copied into
// the CSV export, which is exactly how that starts.
//
// Everything below is inside a function on purpose. Classic <script> tags share
// one global lexical scope, so a top-level binding here collides with whichever
// page script picks the same word and the browser silently refuses to parse the
// second file. See tests/shared-scripts.test.js.
(function attachFindingsColumns() {

// Ordered, human-friendly. A field not named here still appears — appended
// after these — because a scanner that starts emitting something new should
// show up on the day it does, not when somebody remembers to widen this list.
const FIELD_ORDER = ['pillar', 'sub', 'file', 'path', 'fileA', 'fileB', 'line', 'lines', 'scope', 'rule', 'id', 'package', 'installed', 'fixed', 'severity', 'bucket', 'type', 'undescribed', 'stack', 'status', 'rung', 'cc', 'allowed_reason', 'evidence'];

// A field is "present" if any item carries a non-empty value for it. An empty
// array counts as absent, so `evidence: []` does not add a column of nothing.
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

// A cell's text. Arrays are joined, because `evidence` is a list and neither a
// spreadsheet cell nor a table cell is.
function cellText(v) {
  if (Array.isArray(v)) return v.join('; ');
  return String(v == null ? '' : v);
}

// `findings-<system>-<date>.<ext>`. The date is the scan's, not today's — the
// file is a record of a scan, and two downloads of one scan should be the same
// file rather than two files that look like two scans.
function fileName(systemKey, generatedAt, ext) {
  const day = String(generatedAt || '').slice(0, 10);
  const safe = String(systemKey || 'system').replace(/[^A-Za-z0-9._-]/g, '-');
  const stem = day ? `findings-${safe}-${day}` : `findings-${safe}`;
  return `${stem}.${ext}`;
}

const api = { FIELD_ORDER, itemColumns, hasValue, cellText, fileName };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.FindingsColumns = api;

}());
