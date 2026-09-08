'use strict';

// One findings report flattened into a single CSV.
//
// The report is a table per group and each group has different fields, so the
// file is the union of every field any item carries, with three columns in
// front naming the criterion, the sub-metric and its disposition.

// Wrapped: classic <script> tags share one global lexical scope.
(function attachFindingsCsv() {

// Resolved on first use, so a mis-ordered <script> tag fails loudly here
// rather than leaving this file's namespace undefined.
let COLUMNS_CACHE = null;
function columns() {
  if (COLUMNS_CACHE) return COLUMNS_CACHE;
  COLUMNS_CACHE = (typeof require === 'function')
    ? require('./findings-columns.js')
    : (typeof window !== 'undefined' ? window.FindingsColumns : null);
  if (!COLUMNS_CACHE) throw new Error('findings-columns.js must be loaded before this one');
  return COLUMNS_CACHE;
}

// Named the long way round because `sub` and `disposition` are real item
// fields: a shared name appears twice in the header and the item's value is
// lost. Pinned by a test.
const LEAD_COLUMNS = ['criterion', 'sub_metric', 'sub_metric_disposition'];

// Every row the report would draw, tagged with where it came from.
// `criteriaOrder` is supplied so the file cannot disagree with the page.
function flattenFindings(data, criteriaOrder) {
  const criteria = (data && data.criteria) || {};
  const keys = (criteriaOrder && criteriaOrder.length)
    ? criteriaOrder.filter((k) => criteria[k])
    : Object.keys(criteria);
  const rows = [];
  for (const key of keys) {
    const c = criteria[key];
    const label = (c && c.label) || key;
    for (const g of (c && c.groups) || []) {
      for (const it of (g && g.items) || []) {
        if (!it) continue;
        rows.push({
          criterion: label,
          sub_metric: g.label || g.sub || '',
          // Absent means "counts normally", not "unknown".
          sub_metric_disposition: g.disposition || 'counted',
          item: it,
        });
      }
    }
  }
  return rows;
}

// A cell starting = + - @ is a formula to Excel, Sheets and LibreOffice, and
// this data comes from repositories we do not control. The leading apostrophe
// marks it as text and is hidden in the cell.
function neutralise(text) {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

// RFC 4180 quoting, only where the value needs it.
function csvCell(v) {
  const text = neutralise(columns().cellText(v));
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(values) {
  return values.map(csvCell).join(',');
}

// CRLF, per RFC 4180.
function toCsv(data, criteriaOrder) {
  const rows = flattenFindings(data, criteriaOrder);
  const cols = columns().itemColumns(rows.map((r) => r.item));
  const header = LEAD_COLUMNS.concat(cols);
  const lines = [csvRow(header)];
  for (const r of rows) {
    lines.push(csvRow(header.map((c) => (
      LEAD_COLUMNS.includes(c) ? r[c] : r.item[c]
    ))));
  }
  return `${lines.join('\r\n')}\r\n`;
}

// The BOM is for Excel, which otherwise reads UTF-8 as the local codepage.
const BOM = '\uFEFF';

function download(doc, csv, name) {
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url;
  a.download = name;
  doc.body.appendChild(a);
  a.click();
  doc.body.removeChild(a);
  // Safari has not finished with the URL when click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const api = {
  LEAD_COLUMNS, flattenFindings, csvCell, csvRow, toCsv, download, neutralise,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.FindingsCsv = api;

}());
