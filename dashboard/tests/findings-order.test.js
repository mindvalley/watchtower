'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { orderItems } = require('../public/js/findings-columns.js');
const { renderGroup } = require('../public/system/report.js');
const { topFindings } = require('../public/system/scorecard.js');
const { flattenFindings } = require('../public/js/findings-csv.js');
const { reportGroups } = require('../public/js/findings-pdf.js');

const cve = (id, bucket, severity) => ({ package: `pkg-${id}`, id, severity, bucket });

// Scanner order: deliberately scrambled across both keys.
const SCANNED = [
  cve('t-crit', 'transitive', 'critical'),
  cve('d-low', 'dev', 'low'),
  cve('p-med', 'prod', 'medium'),
  cve('d-crit', 'dev', 'critical'),
  cve('p-crit', 'prod', 'critical'),
  cve('t-high', 'transitive', 'high'),
  cve('p-high', 'prod', 'high'),
];
const EXPECTED = ['p-crit', 'p-high', 'p-med', 'd-crit', 'd-low', 't-crit', 't-high'];
const ids = (items) => items.map((it) => it.id);

test('CVEs order by bucket (prod, dev, transitive), then severity (critical first)', () => {
  assert.deepStrictEqual(ids(orderItems(SCANNED)), EXPECTED);
});

test('ordering does not mutate the input', () => {
  const before = ids(SCANNED);
  orderItems(SCANNED);
  assert.deepStrictEqual(ids(SCANNED), before);
});

test('ties and unknown values keep scanner order, unknowns last', () => {
  const items = [cve('a', 'prod', 'high'), cve('x', 'mystery', 'high'), cve('b', 'prod', 'high'), cve('c', 'prod', 'unrated')];
  assert.deepStrictEqual(ids(orderItems(items)), ['a', 'b', 'c', 'x']);
});

test('findings without a bucket keep their order', () => {
  const sast = [{ path: 'b.js', severity: 'low' }, { path: 'a.js', severity: 'critical' }];
  assert.deepStrictEqual(orderItems(sast), sast);
});

const findings = { criteria: { 9: { label: 'Security Posture', groups: [{ sub: 'deps', label: 'Dependency CVEs', items: SCANNED }] } } };

test('the full report table lists CVEs in that order', () => {
  const html = renderGroup(findings.criteria[9].groups[0]);
  const shown = EXPECTED.map((id) => html.indexOf(`>${id}<`));
  assert.ok(shown.every((pos, i) => pos > 0 && (i === 0 || pos > shown[i - 1])), `order in HTML: ${shown}`);
});

test('the Where box takes the top CVEs in that order', () => {
  assert.deepStrictEqual(ids(topFindings(findings.criteria[9].groups[0], 3)), EXPECTED.slice(0, 3));
});

test('the CSV download lists CVEs in that order', () => {
  assert.deepStrictEqual(flattenFindings(findings, ['9']).map((r) => r.item.id), EXPECTED);
});

test('the PDF download lists CVEs in that order', () => {
  assert.deepStrictEqual(ids(reportGroups(findings, ['9'])[0].items), EXPECTED);
});
