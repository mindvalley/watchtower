'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { mergeSystemEntries } = require('../../scripts/benchmark/merge-system-entries');

test('preserves existing systems and adds new ones', () => {
  const existing = { alpha: { score: 4.0 }, bravo: { score: 3.4 } };
  const incoming = { foxtrot: { score: 2.1 } };
  const merged = mergeSystemEntries(existing, incoming);
  assert.deepEqual(merged.alpha, { score: 4.0 });
  assert.deepEqual(merged.bravo, { score: 3.4 });
  assert.deepEqual(merged.foxtrot, { score: 2.1 });
  assert.equal(Object.keys(merged).length, 3);
});

test('incoming wins on key collision; existing object is not mutated', () => {
  const existing = { foxtrot: { score: 1.0 } };
  const incoming = { foxtrot: { score: 2.2 } };
  const merged = mergeSystemEntries(existing, incoming);
  assert.deepEqual(merged.foxtrot, { score: 2.2 });
  assert.deepEqual(existing.foxtrot, { score: 1.0 }); // no mutation
});
