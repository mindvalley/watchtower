const { test } = require('node:test');
const assert = require('node:assert');
const {
  changeCounts, directDependents, definingFiles, buildHotspots, rankPlaces, startWith,
} = require('../../scripts/benchmark/place-ranking');

const deps = (pairs) => {
  const m = new Map();
  for (const [s, t] of pairs) {
    if (!m.has(s)) m.set(s, new Set());
    m.get(s).add(t);
  }
  return m;
};

test('a file counts once per commit that touched it', () => {
  const counts = changeCounts([{ files: ['a.ts', 'b.ts'] }, { files: ['a.ts', 'a.ts'] }]);
  assert.deepStrictEqual([...counts], [['a.ts', 2], ['b.ts', 1]]);
});

test('dependents count direct importers, and tests importing a file do not count', () => {
  const counts = directDependents(deps([
    ['src/page.ts', 'src/api.ts'],
    ['src/form.ts', 'src/api.ts'],
    ['test/api.test.ts', 'src/api.ts'],
  ]));
  assert.strictEqual(counts.get('src/api.ts'), 2);
});

test('a file defines something when the graph holds any node besides the file itself', () => {
  const graph = { nodes: [
    { id: 'f1', source_file: 'src/index.ts' },
    { id: 'f2', source_file: 'src/api.ts' }, { id: 'fn', source_file: 'src/api.ts' },
  ] };
  assert.deepStrictEqual([...definingFiles(graph)], ['src/api.ts']);
});

test('a file that only re-exports earns no credit for being used, but its changes still count', () => {
  const h = buildHotspots({
    deps: deps([['src/a.ts', 'src/index.ts'], ['src/b.ts', 'src/index.ts'], ['src/a.ts', 'src/api.ts']]),
    definers: new Set(['src/api.ts', 'src/a.ts', 'src/b.ts']),
    revisions: [{ files: ['src/index.ts'] }],
    windowDays: 90,
  });
  assert.deepStrictEqual(h.files['src/index.ts'], { dependents: 0, changes: 1 });
  assert.deepStrictEqual(h.files['src/api.ts'], { dependents: 1, changes: 0 });
});

test('only source files are kept; docs, lockfiles and build output are not places', () => {
  const h = buildHotspots({
    revisions: [{ files: ['README.md', 'pnpm-lock.yaml', 'dist/app.js', 'src/app.ts', 'src/App.vue'] }],
    windowDays: 90,
  });
  assert.deepStrictEqual(Object.keys(h.files), ['src/App.vue', 'src/app.ts']);
});

test('hotspots carry only files with a signal, and say what was and was not available', () => {
  const h = buildHotspots({
    deps: deps([['src/a.ts', 'src/b.ts']]), revisions: [{ files: ['src/c.ts'] }], windowDays: 90,
  });
  assert.deepStrictEqual(h.files, {
    'src/b.ts': { dependents: 1, changes: 0 },
    'src/c.ts': { dependents: 0, changes: 1 },
  });
  assert.strictEqual(h.graph, 'built');
  assert.strictEqual(h.history, 'read');
  const bare = buildHotspots({ windowDays: 90, graphUnavailable: 'modules not discoverable' });
  assert.strictEqual(bare.graph, 'modules not discoverable');
  assert.strictEqual(bare.history, 'unavailable');
});

const HOT = buildHotspots({
  deps: deps([
    ['src/x1.ts', 'src/core.ts'], ['src/x2.ts', 'src/core.ts'], ['src/x3.ts', 'src/core.ts'],
  ]),
  revisions: [{ files: ['src/busy.ts'] }, { files: ['src/busy.ts'] }, { files: ['src/core.ts'] }],
  windowDays: 90,
});

test('places are ranked by (used by + 1) × (changes + 1), ties keeping their order', () => {
  const items = [{ file: 'src/quiet.ts' }, { file: 'src/busy.ts' }, { file: 'src/core.ts' }, { file: 'src/other.ts' }];
  const ranked = rankPlaces(items, HOT, { useDependents: true }).map((i) => i.file);
  assert.deepStrictEqual(ranked, ['src/core.ts', 'src/busy.ts', 'src/quiet.ts', 'src/other.ts']);
});

test('where the graph is not trusted, places are ranked by changes alone', () => {
  const items = [{ file: 'src/core.ts' }, { file: 'src/busy.ts' }];
  const ranked = rankPlaces(items, HOT, { useDependents: false }).map((i) => i.file);
  assert.deepStrictEqual(ranked, ['src/busy.ts', 'src/core.ts']);
});

test('scanner paths from the clone directory are matched as repo-relative', () => {
  const items = [{ file: 'src/quiet.ts' }, { file: '/tmp/scan-c8-sys-a1b2/repo/src/core.ts' }];
  assert.strictEqual(rankPlaces(items, HOT, { useDependents: true })[0].file, '/tmp/scan-c8-sys-a1b2/repo/src/core.ts');
});

test('without hotspots the list is returned untouched and no start-with line is made', () => {
  const items = [{ file: 'b' }, { file: 'a' }];
  assert.strictEqual(rankPlaces(items, null, { useDependents: true }), items);
  assert.strictEqual(startWith(items, null, { useDependents: true }), null);
});

test('start-with names distinct files, at most three, and says its basis', () => {
  const ranked = [{ file: 'src/core.ts' }, { file: 'src/core.ts' }, { file: 'src/busy.ts' }];
  assert.strictEqual(
    startWith(ranked, HOT, { useDependents: true }),
    'Start with the most used and most changed: src/core.ts, src/busy.ts.',
  );
  assert.strictEqual(
    startWith([{ file: 'src/busy.ts' }], HOT, { useDependents: false }),
    'Start with the most changed: src/busy.ts.',
  );
});

test('start-with never names a file that has no signal at all', () => {
  assert.strictEqual(startWith([{ file: 'src/quiet.ts' }], HOT, { useDependents: true }), null);
});
