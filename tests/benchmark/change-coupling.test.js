'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  parseGitLog, modulesPerRevision, couplingPairs, CODE_MAAT_DEFAULTS,
} = require('../../scripts/benchmark/change-coupling');

// ─── parseGitLog ─────────────────────────────────────────────────────────────

const LOG = [
  'commit\tabc123',
  'apps/web/src/a.ts',
  'packages/ui/src/b.ts',
  '',
  'commit\tdef456',
  'apps/web/src/c.ts',
  '',
].join('\n');

test('parseGitLog reads one revision per commit with its touched files', () => {
  const revs = parseGitLog(LOG);
  assert.strictEqual(revs.length, 2);
  assert.deepStrictEqual(revs[0], { sha: 'abc123', files: ['apps/web/src/a.ts', 'packages/ui/src/b.ts'] });
  assert.deepStrictEqual(revs[1], { sha: 'def456', files: ['apps/web/src/c.ts'] });
});

test('parseGitLog drops commits that touched no files', () => {
  const revs = parseGitLog('commit\tabc123\n\ncommit\tdef456\napps/web/a.ts\n');
  assert.strictEqual(revs.length, 1);
  assert.strictEqual(revs[0].sha, 'def456');
});

// ─── modulesPerRevision ──────────────────────────────────────────────────────

const MODULES = [
  { name: 'apps/web', prefix: 'apps/web/' },
  { name: 'packages/ui', prefix: 'packages/ui/' },
];

test('modulesPerRevision maps touched files to the distinct modules they belong to', () => {
  const revs = [{ sha: 'a', files: ['apps/web/src/a.ts', 'apps/web/src/b.ts', 'packages/ui/x.ts'] }];
  const out = modulesPerRevision(revs, MODULES);
  assert.deepStrictEqual(out.revisions[0].modules.sort(), ['apps/web', 'packages/ui']);
});

test('modulesPerRevision ignores files outside every declared module', () => {
  const revs = [{ sha: 'a', files: ['README.md', 'apps/web/src/a.ts'] }];
  const out = modulesPerRevision(revs, MODULES);
  assert.deepStrictEqual(out.revisions[0].modules, ['apps/web']);
});

test('modulesPerRevision ignores build output and vendored trees', () => {
  const revs = [{ sha: 'a', files: ['apps/web/node_modules/p/i.js', 'packages/ui/dist/b.js'] }];
  const out = modulesPerRevision(revs, MODULES);
  assert.deepStrictEqual(out.revisions[0].modules, []);
});

test('modulesPerRevision ignores lockfiles, which move for reasons unrelated to the module', () => {
  const revs = [{ sha: 'a', files: ['apps/web/package-lock.json', 'packages/ui/pnpm-lock.yaml'] }];
  const out = modulesPerRevision(revs, MODULES);
  assert.deepStrictEqual(out.revisions[0].modules, []);
});

// A sweeping commit touches everything and would couple every pair to every
// other. code-maat excludes these by default at 30 modules; the count of what
// was excluded is reported, never silently dropped.
test('modulesPerRevision excludes changesets above the size cap and reports the count', () => {
  const wide = Array.from({ length: 31 }, (_, i) => ({ name: `m${i}`, prefix: `m${i}/` }));
  const revs = [{ sha: 'wide', files: wide.map((m) => `${m.prefix}f.ts`) }];
  const out = modulesPerRevision(revs, wide);
  assert.strictEqual(out.revisions.length, 0);
  assert.strictEqual(out.excluded_oversized_changesets, 1);
});

test('modulesPerRevision keeps a changeset exactly at the size cap', () => {
  const wide = Array.from({ length: 30 }, (_, i) => ({ name: `m${i}`, prefix: `m${i}/` }));
  const revs = [{ sha: 'ok', files: wide.map((m) => `${m.prefix}f.ts`) }];
  const out = modulesPerRevision(revs, wide);
  assert.strictEqual(out.revisions.length, 1);
  assert.strictEqual(out.excluded_oversized_changesets, 0);
});

// ─── couplingPairs ───────────────────────────────────────────────────────────

// Build n revisions touching exactly the given module sets.
const revsOf = (...sets) => sets.map((modules, i) => ({ sha: `r${i}`, modules }));

test('coupling degree divides shared revisions by the AVERAGE of the pair, as code-maat does', () => {
  // a: 10 revisions, b: 6 revisions, 6 shared.
  // average = 8 -> 6/8 = 75%. Using the less-active member would give 100%.
  const sets = [];
  for (let i = 0; i < 6; i += 1) sets.push(['a', 'b']);
  for (let i = 0; i < 4; i += 1) sets.push(['a']);
  const { pairs } = couplingPairs(revsOf(...sets), { minCoupling: 0 });
  const ab = pairs.find((p) => p.a === 'a' && p.b === 'b');
  assert.strictEqual(ab.revs_a, 10);
  assert.strictEqual(ab.revs_b, 6);
  assert.strictEqual(ab.shared_revs, 6);
  assert.strictEqual(ab.degree, 75);
});

test('a pair below the 30 percent coupling default is not coupled', () => {
  // a:10 b:10, 2 shared -> 2/10 = 20%
  const sets = [];
  for (let i = 0; i < 2; i += 1) sets.push(['a', 'b']);
  for (let i = 0; i < 8; i += 1) sets.push(['a']);
  for (let i = 0; i < 8; i += 1) sets.push(['b']);
  const { pairs } = couplingPairs(revsOf(...sets));
  assert.strictEqual(pairs.length, 0);
});

test('a module below the minimum revision count is excluded entirely', () => {
  // b has only 4 revisions, under min-revs 5, even though they are all shared.
  const sets = [];
  for (let i = 0; i < 4; i += 1) sets.push(['a', 'b']);
  for (let i = 0; i < 4; i += 1) sets.push(['a']);
  const { pairs } = couplingPairs(revsOf(...sets), { minCoupling: 0, minSharedRevs: 0 });
  assert.strictEqual(pairs.length, 0);
});

test('a pair below the minimum shared revision count is excluded', () => {
  // Both modules clear min-revs; only 4 shared, under min-shared-revs 5.
  const sets = [];
  for (let i = 0; i < 4; i += 1) sets.push(['a', 'b']);
  for (let i = 0; i < 2; i += 1) sets.push(['a']);
  for (let i = 0; i < 2; i += 1) sets.push(['b']);
  const { pairs } = couplingPairs(revsOf(...sets), { minCoupling: 0 });
  assert.strictEqual(pairs.length, 0);
});

test('a genuinely coupled pair is reported with its evidence', () => {
  const sets = [];
  for (let i = 0; i < 8; i += 1) sets.push(['a', 'b']);
  for (let i = 0; i < 2; i += 1) sets.push(['a']);
  for (let i = 0; i < 2; i += 1) sets.push(['b']);
  const { pairs } = couplingPairs(revsOf(...sets));
  assert.strictEqual(pairs.length, 1);
  assert.deepStrictEqual(
    { a: pairs[0].a, b: pairs[0].b, shared: pairs[0].shared_revs, degree: pairs[0].degree },
    { a: 'a', b: 'b', shared: 8, degree: 80 }
  );
});

test('pair identity is order-independent', () => {
  const sets = [];
  for (let i = 0; i < 8; i += 1) sets.push(['b', 'a']);
  for (let i = 0; i < 2; i += 1) sets.push(['a']);
  for (let i = 0; i < 2; i += 1) sets.push(['b']);
  const { pairs } = couplingPairs(revsOf(...sets));
  assert.strictEqual(pairs.length, 1);
  assert.strictEqual(pairs[0].a, 'a');
  assert.strictEqual(pairs[0].b, 'b');
});

test('the published code-maat defaults are the anchor', () => {
  assert.deepStrictEqual(CODE_MAAT_DEFAULTS, {
    minRevs: 5, minSharedRevs: 5, minCoupling: 30, maxChangesetSize: 30,
  });
});

// Too little history to say anything is not the same as clean boundaries.
test('couplingPairs reports how many modules cleared the revision floor', () => {
  const sets = [];
  for (let i = 0; i < 8; i += 1) sets.push(['a', 'b']);
  for (let i = 0; i < 2; i += 1) sets.push(['a']);
  for (let i = 0; i < 2; i += 1) sets.push(['b']);
  sets.push(['c']);
  const { qualifying_modules, total_revisions } = couplingPairs(revsOf(...sets));
  assert.strictEqual(qualifying_modules, 2);
  assert.strictEqual(total_revisions, 13);
});
