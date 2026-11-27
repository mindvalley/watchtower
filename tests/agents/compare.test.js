const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  applyMatches, splitUnmatched, loadPreviousOpen, changedFiles,
} = require('../../agents/oracle/compare');

const finding = (fp, places, extra = {}) => ({
  fingerprint: fp, agreement: `agreement ${fp}`, places, likelihood: 'high', harm: 'high',
  unguarded: '', trigger: '', effect: '', fix: '', verification: { verdict: 'confirmed', note: '' }, ...extra,
});
const RUN = { run: '2026-11-25-0300', commit: 'bbb' };

// --- matching ------------------------------------------------------------

test('a matched finding keeps the earlier id and first sighting; an unmatched one is new', () => {
  const prev = [finding('p1', ['a.ts'], { id: 'old1', first_seen: { run: 'r0', commit: 'aaa' } })];
  const current = [finding('c1', ['a.ts', 'b.ts']), finding('c2', ['z.ts'])];
  const out = applyMatches({ previousOpen: prev, current, matches: [{ current: 'C1', previous: ['P1'] }], ...RUN });
  assert.equal(current[0].id, 'old1');
  assert.deepEqual(current[0].first_seen, { run: 'r0', commit: 'aaa' });
  assert.equal(current[0].change, 'still_open');
  assert.equal(current[1].id, 'c2');
  assert.deepEqual(current[1].first_seen, { run: RUN.run, commit: 'bbb' });
  assert.equal(current[1].change, 'new');
  assert.deepEqual(out.unmatched, []);
  assert.deepEqual(out.outcomes, [{ id: 'old1', status: 'still_open', refound: true, by: 'old1' }]);
});

test('two earlier findings matched to one current finding: the oldest id wins, the other is merged into it', () => {
  const prev = [
    finding('p1', ['a.ts'], { id: 'newer', first_seen: { run: 'r2', commit: 'x' } }),
    finding('p2', ['a.ts'], { id: 'older', first_seen: { run: 'r1', commit: 'w' } }),
  ];
  const current = [finding('c1', ['a.ts'])];
  const out = applyMatches({ previousOpen: prev, current, matches: [{ current: 'C1', previous: ['P1', 'P2'] }], ...RUN });
  assert.equal(current[0].id, 'older');
  const byId = Object.fromEntries(out.outcomes.map((o) => [o.id, o]));
  assert.equal(byId.older.status, 'still_open');
  assert.deepEqual(byId.newer, { id: 'newer', status: 'merged', refound: true, by: 'older' });
});

test('an earlier finding claimed by two current findings keeps its id on the first; the second is a split, with a new id', () => {
  const prev = [finding('p1', ['a.ts'], { id: 'old1', first_seen: { run: 'r0', commit: 'aaa' } })];
  const current = [finding('c1', ['a.ts']), finding('c2', ['a.ts', 'b.ts'])];
  applyMatches({
    previousOpen: prev, current, matches: [{ current: 'C1', previous: ['P1'] }, { current: 'C2', previous: ['P1'] }], ...RUN,
  });
  assert.equal(current[0].id, 'old1');
  assert.equal(current[1].id, 'c2');
  assert.equal(current[1].change, 'split');
  assert.equal(current[1].split_from, 'old1');
});

test('unknown ids and malformed matches are ignored, never trusted', () => {
  const prev = [finding('p1', ['a.ts'], { id: 'old1', first_seen: { run: 'r0', commit: 'aaa' } })];
  const current = [finding('c1', ['a.ts'])];
  const out = applyMatches({
    previousOpen: prev, current, matches: [{ current: 'C9', previous: ['P1'] }, { current: 'C1', previous: ['P7'] }, null, { current: 'C1' }], ...RUN,
  });
  assert.equal(current[0].change, 'new');
  assert.equal(out.unmatched.length, 1);
});

test('a new id never collides with an id already in use', () => {
  const prev = [finding('p1', ['a.ts'], { id: 'c1', first_seen: { run: 'r0', commit: 'aaa' } })];
  const current = [finding('c1', ['q.ts']), finding('c1', ['q.ts'])];
  applyMatches({ previousOpen: prev, current, matches: [], ...RUN });
  const ids = current.map((f) => f.id);
  assert.equal(new Set([...ids, 'c1']).size, 3, ids.join(','));
});

// --- unmatched earlier findings --------------------------------------------

test('an earlier finding not found again whose files did not change is carried forward, with no model call needed', () => {
  const prev = [
    finding('p1', ['src/a.ts:3 (PORT)', 'package.json'], { id: 'k1' }),
    finding('p2', ['src/b.ts'], { id: 'k2' }),
  ];
  const { carried, recheck } = splitUnmatched(prev, new Set(['src/b.ts']));
  assert.deepEqual(carried.map((f) => f.id), ['k1']);
  assert.deepEqual(recheck.map((f) => f.id), ['k2']);
  assert.deepEqual(recheck[0].changed_files, ['src/b.ts']);
});

test('when what changed is unknown, every unmatched finding is re-checked rather than assumed unchanged', () => {
  const prev = [finding('p1', ['a.ts'], { id: 'k1' })];
  const { carried, recheck } = splitUnmatched(prev, null);
  assert.equal(carried.length, 0);
  assert.equal(recheck.length, 1);
  assert.equal(recheck[0].changed_files, null);
});

// --- the previous run -------------------------------------------------------

function writeRun(dir, { findings, changes, run = { status: 'complete', commit: 'aaa' } }) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify(run));
  if (findings) fs.writeFileSync(path.join(dir, 'findings.json'), JSON.stringify({ findings, rejected: [] }));
  if (changes) fs.writeFileSync(path.join(dir, 'changes.json'), JSON.stringify(changes));
}

test('the open set of a run is its findings plus what it carried forward', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-cmp-')), '2026-11-18-0300');
  writeRun(dir, {
    findings: [finding('f1', ['a.ts'], { id: 'f1', first_seen: { run: 'x', commit: 'aaa' } })],
    changes: { carried: [finding('f0', ['b.ts'], { id: 'f0', first_seen: { run: 'w', commit: 'zzz' } })] },
  });
  const prev = loadPreviousOpen(dir);
  assert.equal(prev.commit, 'aaa');
  assert.deepEqual(prev.open.map((f) => f.id).sort(), ['f0', 'f1']);
});

test('a run from before ids existed is read with its fingerprints as ids', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-cmp-')), '2026-11-17-0312');
  writeRun(dir, { findings: [finding('f1', ['a.ts']), finding('f1', ['a.ts'])] });
  const prev = loadPreviousOpen(dir);
  assert.deepEqual(prev.open.map((f) => f.id), ['f1', 'f1-2']);
  assert.deepEqual(prev.open[0].first_seen, { run: '2026-11-17-0312', commit: 'aaa' });
});

// --- what changed between two commits -------------------------------------

function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function repoWithTwoCommits() {
  const origin = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-cmp-origin-'));
  git(origin, 'init', '-q', '-b', 'main');
  git(origin, 'config', 'user.email', 't@example.com');
  git(origin, 'config', 'user.name', 't');
  git(origin, 'config', 'uploadpack.allowReachableSHA1InWant', 'true');
  fs.writeFileSync(path.join(origin, 'a.ts'), '1');
  fs.writeFileSync(path.join(origin, 'b.ts'), '1');
  git(origin, 'add', '.');
  git(origin, 'commit', '-q', '-m', 'one');
  const first = git(origin, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(origin, 'b.ts'), '2');
  git(origin, 'add', '.');
  git(origin, 'commit', '-q', '-m', 'two');
  return { origin, first };
}

test('changed files are listed between the previous commit and now, even in a shallow clone', () => {
  const { origin, first } = repoWithTwoCommits();
  const shallow = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-cmp-clone-')), 'c');
  execFileSync('git', ['clone', '-q', '--depth', '1', `file://${origin}`, shallow]);
  assert.deepEqual([...changedFiles(shallow, first, { fetch: true })], ['b.ts']);
});

test('changed files are unknown, not empty, when the previous commit cannot be found', () => {
  const { origin } = repoWithTwoCommits();
  assert.equal(changedFiles(origin, '0123456789abcdef0123456789abcdef01234567'), null);
  assert.equal(changedFiles(origin, null), null);
  assert.equal(changedFiles(null, 'abc'), null);
});

test('a full repository (a local folder target) is never fetched into: it is only read', () => {
  const { origin } = repoWithTwoCommits();
  const full = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-cmp-full-')), 'c');
  execFileSync('git', ['clone', '-q', `file://${origin}`, full]);
  // A commit only the remote has: fetching it would write to the user's repository.
  fs.writeFileSync(path.join(origin, 'a.ts'), '3');
  git(origin, 'commit', '-q', '-am', 'three');
  const onlyRemote = git(origin, 'rev-parse', 'HEAD');
  const before = git(full, 'count-objects', '-v');
  assert.equal(changedFiles(full, onlyRemote), null);
  assert.equal(git(full, 'count-objects', '-v'), before);
});

test('a shallow checkout that is the user\'s own folder is not fetched into either: fetching is opt-in', () => {
  const { origin, first } = repoWithTwoCommits();
  const shallow = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-cmp-clone-')), 'c');
  execFileSync('git', ['clone', '-q', '--depth', '1', `file://${origin}`, shallow]);
  const before = fs.readFileSync(path.join(shallow, '.git/shallow'), 'utf8');
  assert.equal(changedFiles(shallow, first), null);
  assert.equal(fs.readFileSync(path.join(shallow, '.git/shallow'), 'utf8'), before);
});

test('in a target that is a subfolder of a repository, changed files are relative to the target, like places', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-cmp-sub-'));
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 't');
  fs.mkdirSync(path.join(repo, 'sub'));
  fs.writeFileSync(path.join(repo, 'sub/a.js'), '1');
  fs.writeFileSync(path.join(repo, 'other.js'), '1');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'one');
  const first = git(repo, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(repo, 'sub/a.js'), '2');
  fs.writeFileSync(path.join(repo, 'other.js'), '2');
  git(repo, 'commit', '-q', '-am', 'two');
  assert.deepEqual([...changedFiles(path.join(repo, 'sub'), first)], ['a.js']);
});

test('uncommitted edits count as changed: a local folder is audited as it is on disk', () => {
  const { origin } = repoWithTwoCommits();
  const head = git(origin, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(origin, 'a.ts'), 'edited, not committed');
  assert.deepEqual([...changedFiles(origin, head)], ['a.ts']);
});

test('unusual file names come back as they are, not quoted', () => {
  const { origin } = repoWithTwoCommits();
  const head = git(origin, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(origin, 'café "x".ts'), '1');
  git(origin, 'add', '.');
  git(origin, 'commit', '-q', '-m', 'odd name');
  assert.deepEqual([...changedFiles(origin, head)], ['café "x".ts']);
});

test('places naming a folder, a line anchor or a quoted path still match the files that changed', () => {
  const prev = [
    finding('p1', ['src/config/'], { id: 'dir' }),
    finding('p2', ['src/a.ts#L12'], { id: 'anchor' }),
    finding('p3', ['`src/b.ts`'], { id: 'ticks' }),
    finding('p4', ['src/configuration.ts'], { id: 'prefix-only' }),
  ];
  const { carried, recheck } = splitUnmatched(prev, new Set(['src/config/env.ts', 'src/a.ts', 'src/b.ts']));
  assert.deepEqual(recheck.map((f) => f.id), ['dir', 'anchor', 'ticks']);
  assert.deepEqual(carried.map((f) => f.id), ['prefix-only']);
});

test('ids ever handed out are never handed out again, even after the finding closed', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-cmp-')), '2026-11-18-0300');
  writeRun(dir, {
    findings: [finding('f1', ['a.ts'], { id: 'f1', first_seen: { run: 'x', commit: 'aaa' } })],
    changes: { carried: [], issued_ids: ['f1', 'gone'] },
  });
  const prev = loadPreviousOpen(dir);
  assert.deepEqual([...prev.issued].sort(), ['f1', 'gone']);
  const current = [finding('gone', ['z.ts'])];
  applyMatches({ previousOpen: prev.open, issued: prev.issued, current, matches: [], ...RUN });
  assert.notEqual(current[0].id, 'gone');
});
