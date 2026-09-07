'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { buildAuditTrail } = require('../public/system/scorecard');

// A real C9 shape, trimmed to the audit + sub fields buildAuditTrail reads.
const C9 = {
  sub: {
    secrets: { score: 0, colour: 'red' },
    deps: { score: 1, colour: 'red' },
    sast: { score: 2.5, colour: 'amber' },
  },
  audit: {
    secrets: { raw: 140, triaged: 8, confirmed: 1, review: 7, excluded_by_path: 132 },
    deps: {
      raw: { critical: 1, high: 15, medium: 34, low: 11, total: 61 },
      prod: { critical: 1, high: 4, medium: 24, low: 10, total: 39 },
      dev: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
      transitive: { critical: 0, high: 11, medium: 10, low: 1, total: 22 },
    },
    sast: {
      raw: { critical: 0, high: 17, medium: 165, low: 6, total: 188 },
      triaged: { critical: 0, high: 9, medium: 33, low: 123, total: 165 },
      remapped: 117,
      excluded_by_path: 23,
    },
  },
};

const trail = () => buildAuditTrail(C9);
const byKey = (k) => trail().find((t) => t.key === k);
const stepMap = (k) => Object.fromEntries(byKey(k).steps.map((s) => [s.label, s.value]));

test('buildAuditTrail returns the three C9 sub-metrics in stable order', () => {
  assert.deepStrictEqual(trail().map((t) => t.key), ['secrets', 'deps', 'sast']);
  assert.deepStrictEqual(trail().map((t) => t.label), ['Secrets', 'Dependency CVEs', 'SAST']);
});

test('buildAuditTrail carries each sub-metric score and colour', () => {
  assert.deepStrictEqual(byKey('secrets'), { ...byKey('secrets'), score: 0, colour: 'red' });
  assert.strictEqual(byKey('deps').score, 1);
  assert.strictEqual(byKey('sast').colour, 'amber');
});

test('secrets chain: raw → excluded → triaged → confirmed + review', () => {
  const m = stepMap('secrets');
  assert.strictEqual(m.Raw, '140');
  assert.strictEqual(m['Excluded (test/fixture paths)'], '132');
  assert.strictEqual(m.Triaged, '8');
  assert.strictEqual(m['Confirmed (hard-cap)'], '1');
  assert.strictEqual(m['To review'], '7');
});

test('deps chain: raw → prod (scored) / dev (discounted) / transitive (info), with bands', () => {
  const m = stepMap('deps');
  assert.strictEqual(m['Raw CVEs'], '61 (1C·15H·34M·11L)');
  assert.strictEqual(m['Direct prod (scored)'], '39 (1C·4H·24M·10L)');
  assert.strictEqual(m['Direct dev (discounted)'], '0');
  assert.strictEqual(m['Transitive (info)'], '22 (11H·10M·1L)');
});

test('sast chain: raw → excluded → remapped → triaged, with bands', () => {
  const m = stepMap('sast');
  assert.strictEqual(m.Raw, '188 (17H·165M·6L)');
  assert.strictEqual(m['Excluded (test/fixture paths)'], '23');
  assert.strictEqual(m['Remapped to info'], '117');
  assert.strictEqual(m.Triaged, '165 (9H·33M·123L)');
});

test('zero-valued filter steps are omitted (clean systems show a short chain)', () => {
  const clean = {
    sub: { secrets: { score: 5, colour: 'green' } },
    audit: { secrets: { raw: 0, triaged: 0, confirmed: 0, review: 0, excluded_by_path: 0 } },
  };
  const t = buildAuditTrail(clean);
  const labels = t[0].steps.map((s) => s.label);
  assert.ok(!labels.includes('Excluded (test/fixture paths)'), 'no excluded step when 0');
  assert.ok(!labels.includes('To review'), 'no review step when 0');
  assert.ok(!labels.includes('Confirmed (hard-cap)'), 'no confirmed step when 0');
  assert.deepStrictEqual(labels, ['Raw', 'Triaged']);
});

test('buildAuditTrail returns [] for a criterion with no audit block', () => {
  assert.deepStrictEqual(buildAuditTrail({ sub: {}, score: 4 }), []);
  assert.deepStrictEqual(buildAuditTrail({}), []);
  assert.deepStrictEqual(buildAuditTrail(null), []);
});

test('buildAuditTrail skips unrecognized sub-metrics (e.g. C8 complexity/duplication)', () => {
  const c8 = {
    sub: { complexity: { score: 5, colour: 'green' }, duplication: { score: 2, colour: 'red' } },
    audit: {
      complexity: { tool: 'credo', threshold: 10, violations: 0, loc: 194905 },
      duplication: { tool: 'jscpd', percentage: 5.7 },
    },
  };
  assert.deepStrictEqual(buildAuditTrail(c8), []);
});
