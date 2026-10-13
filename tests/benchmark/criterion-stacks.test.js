'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  documentedApisDisposition, boundaryGraphDisposition, testPairingDisposition,
} = require('../../scripts/benchmark/criterion-stacks');

test('C2 disposition: elixir AST, ruby N/A, others use the agnostic artifact path', () => {
  assert.equal(documentedApisDisposition('elixir'), 'elixir-ast');
  assert.equal(documentedApisDisposition('ruby'), 'na');
  assert.equal(documentedApisDisposition('ts'), 'artifact');
  assert.equal(documentedApisDisposition('python'), 'artifact');
  assert.equal(documentedApisDisposition('toString'), 'artifact'); // prototype-safety (no crash)
});

// C1's graph-derived metrics (cycles, fan-out) are only as good as the code
// graph underneath them. Measured 2026-07-29 against ground truth: on a real umbrella
// the extractor resolved 4 of 8 real cross-app dependencies AND reported one
// edge backwards, so an Elixir "zero cycles" carries no information. JS resolved
// 5 of 6 real code dependencies. Elixir is therefore withheld, not graded.
test('C1 graph disposition: elixir is unreliable, other stacks are usable', () => {
  assert.equal(boundaryGraphDisposition('elixir'), 'unreliable');
  assert.equal(boundaryGraphDisposition('ts'), 'ok');
  assert.equal(boundaryGraphDisposition('python'), 'ok');
  assert.equal(boundaryGraphDisposition('ruby'), 'ok');
});

test('C1 graph disposition is prototype-safe and defaults to usable', () => {
  assert.equal(boundaryGraphDisposition('toString'), 'ok');
  assert.equal(boundaryGraphDisposition(undefined), 'ok');
});

test('C6 pairing: imports only where the graph has been checked against real tests', () => {
  assert.equal(testPairingDisposition('frontend'), 'imports');
  assert.equal(testPairingDisposition('elixir'), 'filename');
  assert.equal(testPairingDisposition('ruby'), 'filename');
});

test('C6 pairing defaults to filename for an unchecked or unknown stack', () => {
  assert.equal(testPairingDisposition('toString'), 'filename');
  assert.equal(testPairingDisposition(undefined), 'filename');
});
