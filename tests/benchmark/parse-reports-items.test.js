// tests/benchmark/parse-reports-items.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { parseTrivy, parseSast, parseDuplication, parseCredo, parseRubocop, parseLizard } = require('../../scripts/benchmark/parse-reports');

test('parseTrivy retains per-CVE items with bucket', () => {
  const report = { Results: [ { Target: 'mix.lock', Vulnerabilities: [
    { Severity: 'CRITICAL', PkgName: 'plug', VulnerabilityID: 'CVE-1', InstalledVersion: '1.0', FixedVersion: '1.1' },
    { Severity: 'HIGH', PkgName: 'devdep', VulnerabilityID: 'CVE-2' },
    { Severity: 'LOW', PkgName: 'trans', VulnerabilityID: 'CVE-3' },
  ] } ] };
  const r = parseTrivy(report, { prodDeps: ['plug'], devDeps: ['devdep'] });
  assert.strictEqual(r.raw.total, 3);            // existing count unchanged
  assert.strictEqual(r.items.length, 3);
  assert.deepStrictEqual(r.items[0], { package: 'plug', id: 'CVE-1', severity: 'critical', installed: '1.0', fixed: '1.1', target: 'mix.lock', bucket: 'prod' });
  assert.strictEqual(r.items[1].bucket, 'dev');
  assert.strictEqual(r.items[2].bucket, 'transitive');
});

test('parseSast (semgrep) retains per-hit items with disposition', () => {
  const report = { results: [
    { check_id: 'a.b.sql-injection', path: 'lib/x.ex', start: { line: 10 }, extra: { severity: 'ERROR' } },
    { check_id: 'a.b.github-actions-mutable-action-tag', path: '.github/workflows/ci.yml', start: { line: 3 }, extra: { severity: 'ERROR' } },
    { check_id: 'a.b.dead', path: 'test/x_test.exs', start: { line: 1 }, extra: { severity: 'WARNING' } },
  ] };
  const r = parseSast(report, 'semgrep', { severityRemap: { 'github-actions-mutable-action-tag': 'INFO' }, excludePaths: ['**/test/**'] });
  assert.strictEqual(r.items.length, 3);
  assert.deepStrictEqual(r.items[0], { id: 'a.b.sql-injection', path: 'lib/x.ex', line: 10, severity: 'high', disposition: 'triaged' });
  assert.strictEqual(r.items[1].disposition, 'remapped');
  assert.strictEqual(r.items[2].disposition, 'excluded');
});

test('parseDuplication retains clone_items without clobbering the clones count', () => {
  const report = { statistics: { total: { percentage: 5.1, duplicatedLines: 40, lines: 800, clones: 2 } },
    duplicates: [ { firstFile: { name: 'a.ex' }, secondFile: { name: 'b.ex' }, lines: 20 } ] };
  const r = parseDuplication(report);
  assert.strictEqual(r.clones, 2);               // existing COUNT field unchanged
  assert.deepStrictEqual(r.clone_items, [ { fileA: 'a.ex', fileB: 'b.ex', lines: 20 } ]);
});

// Finding 2: each complexity parser must emit a `line` field so the Vue offset
// remapping in c8Groups is reachable. Without the field the (line - 1) + lineOffset
// arithmetic is dead code for every tool.

test('parseLizard emits start-line (column 9) as `line` on each violation item', () => {
  // CSV col layout: 0 NLOC, 1 CCN, ... 6 file, 7 name, 8 long-name, 9 start-line, 10 end-line
  const text = '40,13,300,2,40,"big@10-50@src/a.ts","src/a.ts","big","big ( a )",10,50';
  const out = parseLizard({ format: 'csv', text });
  assert.strictEqual(out.items[0].line, 10);
});

test('parseCredo emits line_no as `line` on each violation item', () => {
  const report = { issues: [{
    check: 'Credo.Check.Refactor.CyclomaticComplexity',
    message: 'Function is too complex (cyclomatic complexity is 13, max is 10).',
    filename: 'lib/b.ex', line_no: 7, scope: 'B.big',
  }] };
  const out = parseCredo(report);
  assert.strictEqual(out.items[0].line, 7);
});

test('parseRubocop emits location line as `line` on each violation item', () => {
  const report = { files: [{ path: 'app/a.rb', offenses: [{
    cop_name: 'Metrics/CyclomaticComplexity',
    message: 'Cyclomatic complexity for f is too high. [12/10]',
    location: { start_line: 42, line: 42 },
  }] }] };
  const out = parseRubocop(report);
  assert.strictEqual(out.items[0].line, 42);
});
