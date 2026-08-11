'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { systemsToPublish } = require('../../scripts/benchmark/ingest-publish');

// Which systems a CI run may post is a smaller question than it looks, and
// getting it wrong republishes stale numbers under a fresh timestamp.

test('publishes only systems that declared it', () => {
  assert.deepStrictEqual(systemsToPublish({
    systems: {
      delta: { publish: 'ingest' },
      alpha: {},
      bravo: { publish: 'data-pr' },
    },
  }), ['delta']);
});

test('never publishes a system this run did not scan', () => {
  // A scan_mode:"local" system is not in the CI matrix. The build job preserves
  // its committed entry rather than rebuilding it, so posting it would send data
  // from an earlier scan and stamp it as this run's — a stale number wearing a
  // fresh timestamp. Whichever org scans it is the one that publishes it.
  assert.deepStrictEqual(systemsToPublish({
    systems: {
      delta: { publish: 'ingest' },
      foxtrot: { publish: 'ingest', scan_mode: 'local' },
    },
  }), ['delta']);
});

test('an empty or absent registry is not an error', () => {
  assert.deepStrictEqual(systemsToPublish({ systems: {} }), []);
  assert.deepStrictEqual(systemsToPublish({}), []);
  assert.deepStrictEqual(systemsToPublish(null), []);
});

test('order is stable so a run’s log reads the same way twice', () => {
  const overrides = {
    systems: { bravo: { publish: 'ingest' }, charlie: { publish: 'ingest' }, delta: { publish: 'ingest' } },
  };
  assert.deepStrictEqual(systemsToPublish(overrides), ['bravo', 'charlie', 'delta']);
});
