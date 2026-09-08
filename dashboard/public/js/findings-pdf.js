'use strict';

// The findings report as a PDF, built with jsPDF and its table plugin.
//
// The libraries are ~440 kB and are loaded on demand, so no page load pays for
// them. The browser's own Save as PDF was tried first and does nothing on Save,
// including from the print shortcut with no script involved.

// Wrapped: classic <script> tags share one global lexical scope.
(function attachFindingsPdf() {

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

// Served by server.js out of node_modules, so the version is the lockfile's.
const SCRIPTS = ['/vendor/jspdf.umd.min.js', '/vendor/jspdf.plugin.autotable.min.js'];

// Landscape: a duplication row is two repo paths side by side.
const PAGE = { orientation: 'landscape', unit: 'pt', format: 'a4' };

const INK = {
  text: [17, 24, 39],
  muted: [107, 114, 128],
  rule: [209, 213, 219],
  headFill: [243, 244, 246],
};

// "counted" is the ordinary state and not worth printing.
function dispositionNote(disposition) {
  if (!disposition || disposition === 'counted') return '';
  if (disposition === 'allowed') return ' — allowed, not counted toward the score';
  return ` — ${disposition}`;
}

// Every group the report would draw, flattened to one list.
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

// The library and plugin are passed in, so tests can build a real PDF in Node.
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
      // Keep a heading with its first table rather than at a page foot.
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
      // These tables cross pages; every sheet needs the column names.
      showHead: 'everyPage',
      theme: 'grid',
      tableWidth: width - margin * 2,
    });

    cursor = doc.lastAutoTable.finalY + 22;
  }

  // Last: the page count is not known until every table is laid out.
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

// The promise is cached, so two fast clicks wait on one load.
const loading = new Map();

function loadScript(doc, src) {
  if (loading.has(src)) return loading.get(src);
  const p = new Promise((resolve, reject) => {
    const el = doc.createElement('script');
    el.src = src;
    el.async = false;
    el.onload = () => resolve();
    el.onerror = () => {
      // Not cached as a failure, so the button can be pressed again.
      loading.delete(src);
      reject(new Error(`could not load ${src}`));
    };
    doc.head.appendChild(el);
  });
  loading.set(src, p);
  return p;
}

// In order: the plugin attaches itself to jsPDF.
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
