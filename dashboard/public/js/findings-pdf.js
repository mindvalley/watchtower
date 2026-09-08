'use strict';

// The findings report as a PDF.
//
// WHY THIS EXISTS RATHER THAN THE BROWSER'S OWN SAVE AS PDF, which was tried
// first and is much cheaper: the print dialog opened and its Save did nothing,
// both from the tab this opens and from pressing the print shortcut on the
// report page directly with no script involved at all. The document was fine —
// rendering the same page headlessly produced a valid PDF — so it was the
// interactive print path, which is not something this code can reach or repair.
// The print stylesheet stays, because it is what makes that path good for
// anyone whose browser does work; this is the route that does not depend on it.
//
// The cost is real and worth stating: about 440 kB of jsPDF and its table
// plugin. They are LOADED ON DEMAND, when someone chooses PDF, so no page pays
// for them otherwise — a system page already fetches a findings file that can
// reach 1.2 MB and does not need help being heavy.
//
// The document follows the report rather than dumping a grid: a heading per
// criterion, a sub-heading per group carrying its count and its disposition,
// and one table per group with that group's own columns — the same columns, in
// the same order, that the page and the CSV use.
//
// Everything below is inside a function on purpose. Classic <script> tags share
// one global lexical scope, so a top-level binding here collides with whichever
// page script picks the same word and the browser silently refuses to parse the
// second file. See tests/shared-scripts.test.js.
(function attachFindingsPdf() {

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

// Served by server.js out of node_modules, so the versions are the ones in the
// lockfile rather than copies of a bundle nobody updates.
const SCRIPTS = ['/vendor/jspdf.umd.min.js', '/vendor/jspdf.plugin.autotable.min.js'];

// Landscape, because a findings table is wide: a duplication row is two repo
// paths side by side, and a code-scanning row is a path, a line and a rule id.
// Portrait wraps all of them into three lines each.
const PAGE = { orientation: 'landscape', unit: 'pt', format: 'a4' };

const INK = {
  text: [17, 24, 39],
  muted: [107, 114, 128],
  rule: [209, 213, 219],
  headFill: [243, 244, 246],
};

// "counted" is the ordinary state and saying so on every group is noise. The
// ones worth naming are the ones that change what a number means.
function dispositionNote(disposition) {
  if (!disposition || disposition === 'counted') return '';
  if (disposition === 'allowed') return ' — allowed, not counted toward the score';
  return ` — ${disposition}`;
}

// Every group the report would draw, in the order it draws them, flattened to
// one list so the builder is a loop rather than three nested ones.
function reportGroups(data, criteriaOrder) {
  const criteria = (data && data.criteria) || {};
  const keys = (criteriaOrder && criteriaOrder.length)
    ? criteriaOrder.filter((k) => criteria[k])
    : Object.keys(criteria);
  const out = [];
  for (const key of keys) {
    const c = criteria[key];
    const criterion = (c && c.label) || key;
    for (const g of (c && c.groups) || []) {
      const items = ((g && g.items) || []).filter(Boolean);
      if (!items.length) continue;
      out.push({
        criterion,
        label: g.label || g.sub || '',
        disposition: g.disposition || 'counted',
        columns: columns().itemColumns(items),
        items,
      });
    }
  }
  return out;
}

// Build the document. `jsPDFCtor` and `autoTable` are passed in rather than
// read off a global, which is what lets the tests build a real PDF in Node and
// assert its shape instead of trusting a screenshot of one.
function buildDoc(jsPDFCtor, autoTable, data, criteriaOrder, meta) {
  const doc = new jsPDFCtor(PAGE);
  const width = doc.internal.pageSize.getWidth();
  const margin = 32;
  const system = (meta && meta.system) || (data && data.system) || '';
  const generatedAt = (meta && meta.generatedAt) || (data && data.generated_at) || '';

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...INK.text);
  doc.text(`${system} — findings report`, margin, 44);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...INK.muted);
  doc.text(generatedAt ? `Scanned ${generatedAt}` : 'Agentic Compatibility Benchmark', margin, 60);

  const groups = reportGroups(data, criteriaOrder);
  if (!groups.length) {
    doc.setFontSize(11);
    doc.setTextColor(...INK.text);
    doc.text('No located findings for this system.', margin, 92);
    return doc;
  }

  let cursor = 84;
  let lastCriterion = null;

  for (const g of groups) {
    if (g.criterion !== lastCriterion) {
      // A criterion heading with nothing under it is a heading stranded at the
      // foot of a page, so it moves to the next one with its first table.
      if (cursor > doc.internal.pageSize.getHeight() - 120) {
        doc.addPage();
        cursor = 56;
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(...INK.text);
      doc.text(g.criterion, margin, cursor);
      cursor += 16;
      lastCriterion = g.criterion;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...INK.muted);
    doc.text(`${g.label} · ${g.items.length}${dispositionNote(g.disposition)}`, margin, cursor);
    cursor += 6;

    autoTable(doc, {
      startY: cursor,
      margin: { left: margin, right: margin, top: 56, bottom: 40 },
      head: [g.columns],
      body: g.items.map((it) => g.columns.map((c) => columns().cellText(it[c]))),
      styles: {
        font: 'courier', fontSize: 7, cellPadding: 3, textColor: INK.text, lineColor: INK.rule, lineWidth: 0.25, overflow: 'linebreak',
      },
      headStyles: {
        font: 'helvetica', fontStyle: 'bold', fontSize: 7, textColor: INK.muted, fillColor: INK.headFill,
      },
      // A table running to hundreds of rows crosses pages, and page four with
      // no column names on it is unreadable.
      showHead: 'everyPage',
      theme: 'grid',
      tableWidth: width - margin * 2,
    });

    cursor = doc.lastAutoTable.finalY + 22;
  }

  // Page numbers last, because the count is not known until every table has
  // been laid out.
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...INK.muted);
    doc.text(`${system} · Agentic Compatibility Benchmark`, margin, doc.internal.pageSize.getHeight() - 18);
    doc.text(`${i} / ${pages}`, width - margin, doc.internal.pageSize.getHeight() - 18, { align: 'right' });
  }

  return doc;
}

// Load a script once. The promise is cached rather than the boolean, so two
// fast clicks wait on one load instead of starting two.
const loading = new Map();

function loadScript(doc, src) {
  if (loading.has(src)) return loading.get(src);
  const p = new Promise((resolve, reject) => {
    const el = doc.createElement('script');
    el.src = src;
    el.async = false;
    el.onload = () => resolve();
    el.onerror = () => {
      // Not cached as a failure: a reader who lost the network for a moment
      // should be able to press the button again.
      loading.delete(src);
      reject(new Error(`could not load ${src}`));
    };
    doc.head.appendChild(el);
  });
  loading.set(src, p);
  return p;
}

// In order — the table plugin attaches itself to jsPDF and cannot load first.
async function loadLibraries(win, doc) {
  for (const src of SCRIPTS) await loadScript(doc, src);
  const ctor = win.jspdf && win.jspdf.jsPDF;
  if (!ctor) throw new Error('jsPDF did not register itself');
  const autoTable = win.jspdf.autoTable || win.autoTable;
  if (typeof autoTable !== 'function') throw new Error('the table plugin did not register itself');
  return { ctor, autoTable };
}

async function download(win, doc, data, criteriaOrder, meta) {
  const { ctor, autoTable } = await loadLibraries(win, doc);
  const pdf = buildDoc(ctor, autoTable, data, criteriaOrder, meta);
  pdf.save(columns().fileName((meta && meta.system) || data.system, (meta && meta.generatedAt) || data.generated_at, 'pdf'));
}

const api = { buildDoc, reportGroups, dispositionNote, loadLibraries, download, SCRIPTS, PAGE };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.FindingsPdf = api;

}());
