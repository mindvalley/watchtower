'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { formatSummary } = require('../scripts/print-scores');

const bench = {
  example: false,
  systems: {
    demo: {
      score: 62, colour: 'amber', coverage: '7 of 7 assessed',
      criteria: { 1: { score: 4.2 }, 2: { score: 1.1 }, 9: { score: 3.2 } },
    },
  },
};

test('formatSummary shows composite, band and per-criterion scores', () => {
  const out = formatSummary(bench);
  assert.match(out, /demo — 62\/100 \(amber\)/);
  assert.match(out, /7 of 7 assessed/);
  assert.match(out, /C1 4\.2/);
  assert.match(out, /C9 3\.2/);
});

test('a withheld/null criterion score renders as a dash, not null', () => {
  const withNull = {
    systems: { s: { score: 30, colour: 'red', criteria: { 1: { score: null }, 9: { score: 2 } } } },
  };
  const out = formatSummary(withNull);
  assert.match(out, /C1 —/);
  assert.doesNotMatch(out, /null/);
});

test('criteria print in numeric order regardless of key order', () => {
  const out = formatSummary(bench);
  assert.ok(out.indexOf('C1') < out.indexOf('C2'));
  assert.ok(out.indexOf('C2') < out.indexOf('C9'));
});

test('empty or missing systems is a clear message, not a crash', () => {
  assert.match(formatSummary({ systems: {} }), /No systems/);
  assert.match(formatSummary({}), /No systems/);
});

test('sample data is labelled', () => {
  const out = formatSummary({ example: true, systems: { s: { score: 50, colour: 'amber', criteria: {} } } });
  assert.match(out, /sample data/i);
});
