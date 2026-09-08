'use strict';

// One findings report, flattened into one CSV.
//
// The report page draws a table per group — eleven of them on the largest
// system — and every group carries different fields: duplication is
// fileA/fileB/lines, a dependency CVE is package/id/severity/installed/fixed,
// an observability pillar is pillar/rung/evidence. A CSV is one table, so the
// export is the union of every field any item carries, with the three columns
// that say WHICH table a row came from in front of it. Sparse, and complete.
//
// The alternative was a file per group in a zip. That needs a zip library for
// the sake of avoiding blank cells in a spreadsheet, where blank cells are
// exactly what a filter is for.
//
// Everything below is inside a function on purpose. Classic <script> tags share
// one global lexical scope, so a top-level binding here collides with whichever
// page script picks the same word and the browser silently refuses to parse the
// second file. See tests/shared-scripts.test.js.
(function attachFindingsCsv() {

// Resolved on first use rather than at load. A top-level read means this file
// only defines its namespace if a sibling tag came first, so a mis-ordered
// <script> would leave the page script holding `undefined` with nothing said
// about why. This way the file always registers, and a genuinely missing
// sibling fails loudly at the moment somebody asks for a download.
let COLUMNS_CACHE = null;
function columns() {
  if (COLUMNS_CACHE) return COLUMNS_CACHE;
  COLUMNS_CACHE = (typeof require === 'function')
    ? require('./findings-columns.js')
    : (typeof window !== 'undefined' ? window.FindingsColumns : null);
  if (!COLUMNS_CACHE) throw new Error('findings-columns.js must be loaded before this one');
  return COLUMNS_CACHE;
}

// The three columns in front of every row. The disposition matters more than
// it looks: an allowed finding is on the report and NOT in the score, and a
// spreadsheet with no way to tell them apart would overstate the work
// outstanding on every export.
//
// The names are long because the short ones are taken. A deployment-capability
// item carries its own `sub`, and a SAST item carries its own `disposition` —
// so `sub` and `disposition` as lead columns would each appear twice in the
// header, with the group's value winning and the item's silently deleted. Both
// collisions are in today's real data and neither was in the fixture written
// first; `LEAD_COLUMNS must not collide with any item field` is the test that
// keeps it that way.
const LEAD_COLUMNS = ['criterion', 'sub_metric', 'sub_metric_disposition'];

// Every row the report would draw, in the order the report draws them, each
// tagged with the criterion and group it came from.
//
// `criteriaOrder` is passed in rather than hardcoded, so the export follows
// whatever order the page is showing rather than a second opinion about it.
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
          // An absent disposition is not "unknown", it is "counts normally".
          // Leaving the cell blank would make the reader guess.
          sub_metric_disposition: g.disposition || 'counted',
          item: it,
        });
      }
    }
  }
  return rows;
}

// Excel, Sheets and LibreOffice treat a cell beginning = + - @ (or a leading
// tab / carriage return) as a formula. Findings data carries paths, rule ids
// and package names out of repositories we do not control — the same
// semi-trusted input the report page HTML-escapes for exactly this reason — so
// a file named `=cmd|...` would arrive as something a spreadsheet tries to run.
//
// The guard is a leading apostrophe, which every spreadsheet reads as "this is
// text" and hides. The value is unchanged for anything reading the file as data.
function neutralise(text) {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

// RFC 4180: wrap in quotes when the value carries a comma, quote, CR or LF, and
// double any quote inside. Quoting unconditionally would be simpler and would
// also quote every empty cell, which reads as `""` in a diff and in every
// text editor.
function csvCell(v) {
  const text = neutralise(columns().cellText(v));
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(values) {
  return values.map(csvCell).join(',');
}

// The whole export. CRLF line endings, which is what RFC 4180 specifies and
// what Excel expects.
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

// Hand the browser a file. The BOM is for Excel, which otherwise reads a UTF-8
// file as the local codepage and mangles any non-ASCII path. Written as an
// escape rather than the character itself, which is invisible in every editor
// and would be deleted by the first person tidying the line.
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
  // Revoked on a later turn of the loop: Safari has not finished with the URL
  // when click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const api = {
  LEAD_COLUMNS, flattenFindings, csvCell, csvRow, toCsv, download, neutralise,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.FindingsCsv = api;

}());
