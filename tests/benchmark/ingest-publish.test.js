'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { systemsToPublish } = require('../../scripts/benchmark/ingest-publish');

// Which systems a run may post is a smaller question than it looks, and getting
// it wrong republishes stale numbers under a fresh timestamp.
//
// The set comes from the run manifest — what was assembled — filtered by where
// each system's results are meant to go. It is never derived from the config's
// own list, because a watchtower is responsible for more systems than any one
// run necessarily measures.

const manifest = (...systems) => ({ systems });

test('publishes a system this run assembled and that is destined for a database', () => {
  assert.deepStrictEqual(
    systemsToPublish(
      { systems: { delta: { publish: 'ingest' }, alpha: {}, bravo: { publish: 'data-pr' } } },
      manifest('delta', 'alpha', 'bravo'),
    ),
    ['delta'],
  );
});

test('never publishes a system this run did not assemble', () => {
  // The case this exists for: a board carrying results it did not produce this
  // run. They are in the config and in the output file, and posting them would
  // send an earlier scan's numbers stamped as this one's — worse than not
  // publishing at all, because the board would look freshly measured.
  assert.deepStrictEqual(
    systemsToPublish(
      { systems: { delta: { publish: 'ingest' }, foxtrot: { publish: 'ingest' } } },
      manifest('delta'),
    ),
    ['delta'],
  );
});

test('a watchtower declares its destination once, at the top', () => {
  // The ordinary shape for a watchtower scanning on someone's behalf: every
  // system it measures goes to the same place, so it says so once rather than
  // repeating a flag on each entry.
  assert.deepStrictEqual(
    systemsToPublish(
      { publish: 'ingest', systems: { golf: {}, hotel: {}, india: {} } },
      manifest('golf', 'hotel', 'india'),
    ),
    ['golf', 'hotel', 'india'],
  );
});

test('a per-system destination overrides the top-level one', () => {
  assert.deepStrictEqual(
    systemsToPublish(
      { publish: 'ingest', systems: { golf: {}, hotel: { publish: 'data-pr' } } },
      manifest('golf', 'hotel'),
    ),
    ['golf'],
  );
});

test('no destination declared anywhere posts nothing', () => {
  // A run with nowhere to send results writes its files and stops. This is the
  // default, and it must not be an error: it is how a local run behaves.
  assert.deepStrictEqual(
    systemsToPublish({ systems: { golf: {}, hotel: {} } }, manifest('golf', 'hotel')),
    [],
  );
});

test('a manifest naming something the config does not list is ignored, not posted', () => {
  // Registry fields — repo, stack, tool — come from the config entry. A system
  // with no entry has none of them, so there is nothing to post under and no
  // safe guess to make.
  assert.deepStrictEqual(
    systemsToPublish({ publish: 'ingest', systems: { golf: {} } }, manifest('golf', 'juliett')),
    ['golf'],
  );
});

test('an empty or absent input is not an error', () => {
  assert.deepStrictEqual(systemsToPublish({ systems: {} }, manifest()), []);
  assert.deepStrictEqual(systemsToPublish({}, manifest()), []);
  assert.deepStrictEqual(systemsToPublish(null, null), []);
});

test('order is stable so a run’s log reads the same way twice', () => {
  const config = { publish: 'ingest', systems: { bravo: {}, charlie: {}, delta: {} } };
  assert.deepStrictEqual(systemsToPublish(config, manifest('delta', 'bravo', 'charlie')), ['bravo', 'charlie', 'delta']);
});
