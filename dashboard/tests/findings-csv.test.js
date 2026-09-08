// The output is parsed back rather than matched against substrings: a quoting
// bug produces plausible-looking text that a substring assertion waves through.

const { test } = require('node:test');
const assert = require('node:assert');
const {
  toCsv, flattenFindings, csvCell, csvRow, neutralise, LEAD_COLUMNS,
} = require('../public/js/findings-csv.js');
const { itemColumns, fileName, FIELD_ORDER } = require('../public/js/findings-columns.js');

// The order the scorecard and report pages show criteria in.
const ORDER = ['2', '4', '6', '7', '8', '9'];

// Minimal RFC 4180 reader: assert what a spreadsheet would load.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else { quoted = false; }
      } else { field += c; }
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r' && text[i + 1] === '\n') {
      row.push(field); rows.push(row); row = []; field = ''; i += 1; continue;
    }
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function sample() {
  return {
    system: 'billing',
    generated_at: '2026-09-08T04:17:00Z',
    criteria: {
      8: {
        label: 'Codebase Simplicity',
        groups: [
          { sub: 'complexity', label: 'Cyclomatic complexity', items: [{ scope: 'Foo.bar/2', file: 'lib/foo.ex', line: 12, cc: 14, language: 'elixir' }] },
          { sub: 'duplication', label: 'Duplication', items: [{ fileA: 'a.ex', fileB: 'b.ex', lines: 17 }] },
        ],
      },
      9: {
        label: 'Security Posture',
        groups: [
          { sub: 'secrets', label: 'Secrets', disposition: 'confirmed', items: [{ file: 'config/prod.exs', rule: 'private-key' }] },
          {
            sub: 'secrets',
            label: 'Secrets',
            disposition: 'allowed',
            items: [{ file: 'config/dev.exs', rule: 'generic-api-key', allowed_reason: 'Public reCAPTCHA site key' }],
          },
        ],
      },
      4: {
        label: 'Observable State',
        groups: [{ sub: 'pillars', label: 'Observability pillars', items: [{ pillar: 'tracing', rung: 'declared', evidence: ['mix.exs', 'config/config.exs'] }] }],
      },
    },
  };
}

test('every finding becomes exactly one row, in criterion order', () => {
  const rows = flattenFindings(sample(), ORDER);
  assert.strictEqual(rows.length, 5, 'five items across four groups');
  assert.deepStrictEqual(rows.map((r) => r.criterion), [
    'Observable State', 'Codebase Simplicity', 'Codebase Simplicity', 'Security Posture', 'Security Posture',
  ]);
});

test('a row says which table it came from', () => {
  const [first] = flattenFindings(sample(), ORDER);
  assert.strictEqual(first.criterion, 'Observable State');
  assert.strictEqual(first.sub_metric, 'Observability pillars');
});

test('a group with no disposition reads "counted", not blank', () => {
  const rows = flattenFindings(sample(), ORDER);
  const complexity = rows.find((r) => r.sub_metric === 'Cyclomatic complexity');
  assert.strictEqual(complexity.sub_metric_disposition, 'counted');
});

test('an allowed finding keeps its disposition so it can be filtered out', () => {
  // On the report, not in the score.
  const rows = flattenFindings(sample(), ORDER);
  const allowed = rows.filter((r) => r.sub_metric_disposition === 'allowed');
  assert.strictEqual(allowed.length, 1);
  assert.strictEqual(allowed[0].item.allowed_reason, 'Public reCAPTCHA site key');
});

test('LEAD_COLUMNS must not collide with any item field', () => {
  // A collision puts one name in the header twice and the item's value is lost.
  // `sub` and `disposition` are both real item fields.
  for (const lead of LEAD_COLUMNS) {
    assert.ok(!FIELD_ORDER.includes(lead), `${lead} is both a lead column and an item field`);
  }
});

test('an item field sharing a lead column name would be caught, not overwritten', () => {
  const data = {
    criteria: {
      7: {
        label: 'Deployment Safety',
        groups: [{ sub: 'capabilities', label: 'Deployment capabilities', items: [{ sub: 'rollback', rung: 'none' }] }],
      },
    },
  };
  const rows = parseCsv(toCsv(data, ORDER));
  const header = rows[0];
  assert.strictEqual(new Set(header).size, header.length, 'no column name may appear twice');
  assert.strictEqual(rows[1][header.indexOf('sub')], 'rollback', "the item's own sub survives");
  assert.strictEqual(rows[1][header.indexOf('sub_metric')], 'Deployment capabilities');
});

test('the header is the three lead columns then the union of item fields', () => {
  const [header] = parseCsv(toCsv(sample(), ORDER));
  assert.deepStrictEqual(header.slice(0, 3), LEAD_COLUMNS);
  // Union across all four groups, ordered by FIELD_ORDER, then anything
  // FIELD_ORDER does not name (`language`).
  assert.deepStrictEqual(header.slice(3), [
    'pillar', 'file', 'fileA', 'fileB', 'line', 'lines', 'scope', 'rule', 'rung', 'cc', 'allowed_reason', 'evidence', 'language',
  ]);
});

test('a field no item uses does not become a column', () => {
  const header = itemColumns([{ file: 'a.ex' }]);
  assert.deepStrictEqual(header, ['file']);
});

test('an empty array is absent rather than a column of nothing', () => {
  assert.deepStrictEqual(itemColumns([{ file: 'a.ex', evidence: [] }]), ['file']);
});

test('a field nobody listed is appended rather than dropped', () => {
  const cols = itemColumns([{ file: 'a.ex', brand_new_field: 'x' }]);
  assert.deepStrictEqual(cols, ['file', 'brand_new_field']);
});

test('the output parses back to one row per finding plus a header', () => {
  const rows = parseCsv(toCsv(sample(), ORDER));
  assert.strictEqual(rows.length, 6, 'header + five findings');
  rows.forEach((r) => assert.strictEqual(r.length, rows[0].length, 'every row has the header width'));
});

test('commas, quotes and newlines survive a round trip', () => {
  const data = {
    criteria: {
      9: {
        label: 'Security Posture',
        groups: [{
          sub: 'sast',
          label: 'SAST',
          items: [{ path: 'lib/a,b.ex', id: 'rule "quoted"', severity: 'high\nlow' }],
        }],
      },
    },
  };
  const rows = parseCsv(toCsv(data, ORDER));
  const [, row] = rows;
  const header = rows[0];
  assert.strictEqual(row[header.indexOf('path')], 'lib/a,b.ex');
  assert.strictEqual(row[header.indexOf('id')], 'rule "quoted"');
  assert.strictEqual(row[header.indexOf('severity')], 'high\nlow');
});

test('a value that a spreadsheet would run as a formula is neutralised', () => {
  for (const bad of ['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx']) {
    assert.ok(neutralise(bad).startsWith("'"), `${JSON.stringify(bad)} must be neutralised`);
  }
  const data = {
    criteria: {
      9: {
        label: 'Security Posture',
        groups: [{ sub: 'secrets', label: 'Secrets', items: [{ file: '=cmd|\' /c calc\'!A1', rule: 'generic-api-key' }] }],
      },
    },
  };
  const rows = parseCsv(toCsv(data, ORDER));
  const value = rows[1][rows[0].indexOf('file')];
  assert.ok(value.startsWith("'"), 'the leading = must not reach a spreadsheet as a formula');
  assert.ok(value.includes('cmd|'), 'the value itself is preserved, only prefixed');
});

test('the guard fires on the first character only', () => {
  assert.strictEqual(neutralise('lib/a=b.ex'), 'lib/a=b.ex');
  assert.strictEqual(neutralise('CVE-2024-1'), 'CVE-2024-1');
  assert.strictEqual(neutralise(''), '');
});

test('a list field is joined rather than rendered as an array', () => {
  const rows = parseCsv(toCsv(sample(), ORDER));
  const header = rows[0];
  const pillar = rows.find((r) => r[header.indexOf('pillar')] === 'tracing');
  assert.strictEqual(pillar[header.indexOf('evidence')], 'mix.exs; config/config.exs');
});

test('an empty cell is empty, not a pair of quotes', () => {
  assert.strictEqual(csvCell(null), '');
  assert.strictEqual(csvCell(undefined), '');
  assert.strictEqual(csvRow(['a', null, 'b']), 'a,,b');
});

test('criteria the data does not have are skipped, not emitted empty', () => {
  const rows = flattenFindings({ criteria: { 9: { label: 'Security Posture', groups: [] } } }, ORDER);
  assert.deepStrictEqual(rows, []);
});

test('no findings produces a header and nothing else, rather than throwing', () => {
  const csv = toCsv({ criteria: {} }, ORDER);
  assert.strictEqual(parseCsv(csv).length, 1);
  assert.deepStrictEqual(parseCsv(csv)[0], LEAD_COLUMNS);
});

test('the file is named for the scan, not for today', () => {
  assert.strictEqual(fileName('billing', '2026-09-08T04:17:00Z', 'csv'), 'findings-billing-2026-09-08.csv');
  assert.strictEqual(fileName('billing', '', 'csv'), 'findings-billing.csv');
});

test('a system key cannot put a path into the filename', () => {
  const name = fileName('../../etc/passwd', '2026-09-08', 'csv');
  assert.ok(!name.includes('/'), 'no separator may survive');
  assert.strictEqual(name, 'findings-..-..-etc-passwd-2026-09-08.csv');
});
