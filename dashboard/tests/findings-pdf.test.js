// These build real PDFs with the real libraries and assert what came out.

const { test } = require('node:test');
const assert = require('node:assert');
const { jsPDF } = require('jspdf');
const autoTable = require('jspdf-autotable').default || require('jspdf-autotable');
const {
  buildDoc, reportGroups, dispositionNote, SCRIPTS,
} = require('../public/js/findings-pdf.js');
const { fileName } = require('../public/js/findings-columns.js');

const ORDER = ['2', '4', '6', '7', '8', '9'];

function sample() {
  return {
    system: 'billing',
    generated_at: '2026-09-08T04:17:00Z',
    criteria: {
      8: {
        label: 'Codebase Simplicity',
        groups: [
          { sub: 'complexity', label: 'Cyclomatic complexity', items: [{ scope: 'Foo.bar/2', file: 'lib/foo.ex', line: 12, cc: 14 }] },
          { sub: 'duplication', label: 'Duplication', items: [{ fileA: 'a.ex', fileB: 'b.ex', lines: 17 }] },
        ],
      },
      9: {
        label: 'Security Posture',
        groups: [
          { sub: 'secrets', label: 'Secrets', disposition: 'confirmed', items: [{ file: 'config/prod.exs', rule: 'private-key' }] },
          { sub: 'secrets', label: 'Secrets', disposition: 'allowed', items: [{ file: 'config/dev.exs', rule: 'generic-api-key', allowed_reason: 'Public site key' }] },
        ],
      },
      4: {
        label: 'Observable State',
        groups: [{ sub: 'pillars', label: 'Observability pillars', items: [{ pillar: 'tracing', rung: 'declared', evidence: ['mix.exs', 'config/config.exs'] }] }],
      },
    },
  };
}

const build = (data, order = ORDER) => buildDoc(jsPDF, autoTable, data, order, null);

// Every string drawn into the document, page by page.
function textOf(doc) {
  const pages = [];
  for (let i = 1; i <= doc.getNumberOfPages(); i += 1) {
    const page = doc.internal.pages[i] || [];
    pages.push(page.join('\n'));
  }
  return pages;
}

test('a real PDF comes out, with pages in it', () => {
  const doc = build(sample());
  assert.ok(doc.getNumberOfPages() >= 1);
  const bytes = Buffer.from(doc.output('arraybuffer'));
  assert.ok(bytes.length > 1000, 'a PDF under a kilobyte is an empty one');
  assert.strictEqual(bytes.subarray(0, 5).toString(), '%PDF-', 'must actually be a PDF');
});

test('every group the report would draw becomes a table, in criterion order', () => {
  const groups = reportGroups(sample(), ORDER);
  assert.deepStrictEqual(groups.map((g) => `${g.criterion} / ${g.label}`), [
    'Observable State / Observability pillars',
    'Codebase Simplicity / Cyclomatic complexity',
    'Codebase Simplicity / Duplication',
    'Security Posture / Secrets',
    'Security Posture / Secrets',
  ]);
});

test('a group with no items is left out rather than drawn empty', () => {
  const groups = reportGroups({
    criteria: { 9: { label: 'Security Posture', groups: [{ sub: 'sast', label: 'SAST', items: [] }] } },
  }, ORDER);
  assert.deepStrictEqual(groups, []);
});

// The reason the PDF is worth having over the CSV, which has to flatten every
// group into one set of columns.
test('each group carries its own columns, not a shared union', () => {
  const groups = reportGroups(sample(), ORDER);
  const byLabel = Object.fromEntries(groups.map((g) => [g.label + g.disposition, g.columns]));
  assert.deepStrictEqual(byLabel['Duplicationcounted'], ['fileA', 'fileB', 'lines']);
  assert.deepStrictEqual(byLabel['Cyclomatic complexitycounted'], ['file', 'line', 'scope', 'cc']);
  assert.deepStrictEqual(byLabel['Observability pillarscounted'], ['pillar', 'rung', 'evidence']);
});

test('an allowed group says it is not counted; an ordinary one says nothing', () => {
  assert.match(dispositionNote('allowed'), /not counted toward the score/);
  assert.strictEqual(dispositionNote('counted'), '');
  assert.strictEqual(dispositionNote(undefined), '');
  assert.match(dispositionNote('confirmed'), /confirmed/);
});

test('the document names the system and the scan date', () => {
  const text = textOf(build(sample())).join('\n');
  assert.match(text, /billing/);
  assert.match(text, /2026-09-08/);
});

test('no finding is lost between the report and the PDF', () => {
  const data = sample();
  const expected = reportGroups(data, ORDER).reduce((n, g) => n + g.items.length, 0);
  const text = textOf(build(data)).join('\n');
  // Every item contributes at least one distinctive value.
  for (const needle of ['Foo.bar/2', 'a.ex', 'config/prod.exs', 'config/dev.exs', 'tracing']) {
    assert.ok(text.includes(needle), `${needle} is missing from the document`);
  }
  assert.strictEqual(expected, 5);
});

test('a long table runs onto more pages rather than off the bottom of one', () => {
  const many = Array.from({ length: 400 }, (_, i) => ({ file: `lib/file_${i}.ex`, line: i, rule: 'some-rule' }));
  const doc = build({
    system: 'billing',
    criteria: { 9: { label: 'Security Posture', groups: [{ sub: 'sast', label: 'SAST', items: many }] } },
  });
  assert.ok(doc.getNumberOfPages() > 1, '400 rows must not claim to fit on one page');
  const text = textOf(doc);
  assert.ok(text[0].includes('lib/file_0.ex'), 'the first row is on the first page');
  assert.ok(text[text.length - 1].includes('lib/file_399.ex'), 'the last row is on the last page');
});

test('a table that crosses a page keeps its column names', () => {
  const many = Array.from({ length: 400 }, (_, i) => ({ file: `lib/file_${i}.ex`, rule: 'some-rule' }));
  const pages = textOf(build({
    system: 'billing',
    criteria: { 9: { label: 'Security Posture', groups: [{ sub: 'sast', label: 'SAST', items: many }] } },
  }));
  assert.ok(pages.length > 1);
  for (const [i, page] of pages.entries()) {
    assert.ok(page.includes('file') && page.includes('rule'), `page ${i + 1} has no column names`);
  }
});

test('every page is numbered', () => {
  const many = Array.from({ length: 300 }, (_, i) => ({ file: `lib/file_${i}.ex` }));
  const doc = build({
    system: 'billing',
    criteria: { 9: { label: 'Security Posture', groups: [{ sub: 'sast', label: 'SAST', items: many }] } },
  });
  const pages = textOf(doc);
  pages.forEach((page, i) => {
    assert.ok(page.includes(`${i + 1} / ${pages.length}`), `page ${i + 1} is not numbered`);
  });
});

test('a system with nothing located says so instead of producing a blank sheet', () => {
  const text = textOf(build({ system: 'billing', criteria: {} })).join('\n');
  assert.match(text, /No located findings/);
});

test('the file is named for the scan and ends in .pdf', () => {
  assert.strictEqual(fileName('billing', '2026-09-08T04:17:00Z', 'pdf'), 'findings-billing-2026-09-08.pdf');
  assert.strictEqual(fileName('billing', '2026-09-08T04:17:00Z', 'csv'), 'findings-billing-2026-09-08.csv');
});

test('the libraries are loaded from paths the server actually serves', () => {
  // Fetched on demand, so no page load would catch a typo.
  const server = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
  for (const src of SCRIPTS) {
    assert.ok(server.includes(`'${src}'`), `server.js does not serve ${src}`);
  }
});

test('the plugin loads after jsPDF, because it attaches itself to it', () => {
  assert.match(SCRIPTS[0], /jspdf\.umd/);
  assert.match(SCRIPTS[1], /autotable/);
});
