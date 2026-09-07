'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  targetOf, materialise, walkFiles, copyFiles,
} = require('../../scripts/benchmark/target-tree');
const { relativize } = require('../../scripts/benchmark/repo-paths');

// Temp directories made by this file, removed at the end. Kept in a list rather
// than cleaned per-test so a failure leaves the evidence behind.
const made = [];
function tmpdir(name) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `wt-test-${name}-`));
  made.push(d);
  return d;
}
function write(root, rel, body = 'x\n') {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
  return full;
}
const git = (dir, ...args) => execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });

function gitRepo(name) {
  const d = tmpdir(name);
  git(d, 'init', '--quiet', '-b', 'main');
  git(d, 'config', 'user.email', 'test@example.invalid');
  git(d, 'config', 'user.name', 'test');
  return d;
}

test.after(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

// --- what a config says the target is -------------------------------------

test('a repo is a repo and a path is resolved against the config directory', () => {
  assert.deepEqual(
    targetOf({ repo: 'org/billing' }, 'billing', '/etc/watchtower'),
    { kind: 'repo', repo: 'org/billing', label: 'org/billing' },
  );
  const local = targetOf({ path: 'code/billing' }, 'billing', '/etc/watchtower');
  assert.equal(local.kind, 'path');
  assert.equal(local.path, path.resolve('/etc/watchtower', 'code/billing'));
});

// Not against the working directory, which would make one config mean different
// things depending on where the shell happened to be.
test('an absolute path is left alone and a relative one ignores the cwd', () => {
  assert.equal(targetOf({ path: '/srv/billing' }, 'b', '/etc/watchtower').path, '/srv/billing');
  assert.equal(
    targetOf({ path: 'sub' }, 'b', '/etc/watchtower').path,
    path.join('/etc/watchtower', 'sub'),
  );
});

// Two answers to one question. Choosing either silently would let a stale entry
// score the wrong code, and the report would name the system, not the source.
test('declaring both repo and path is refused rather than resolved', () => {
  assert.throws(
    () => targetOf({ repo: 'org/b', path: '/srv/b' }, 'billing', '/etc'),
    /declares both repo and path/,
  );
});

test('declaring neither is refused, and the message says what to set', () => {
  assert.throws(() => targetOf({ stack: 'elixir' }, 'billing', '/etc'), /declares neither repo nor path/);
  assert.throws(() => targetOf({ repo: '' }, 'billing', '/etc'), /declares neither repo nor path/);
});

// --- materialising a local folder -----------------------------------------

test('a local target is copied into the same shape a clone lands in', () => {
  const src = gitRepo('src');
  write(src, 'lib/app.ex');
  git(src, 'add', '-A');
  git(src, 'commit', '--quiet', '-m', 'first');

  const tree = materialise(targetOf({ path: src }, 'billing', '/'), { prefix: 'billing' });
  try {
    assert.equal(path.basename(tree.dir), 'repo');
    assert.match(path.basename(path.dirname(tree.dir)), /^scan-billing-/);
    assert.ok(fs.existsSync(path.join(tree.dir, 'lib/app.ex')));
  } finally {
    tree.cleanup();
  }
});

// THE REASON THE SHAPE MATTERS. Third-party scanners report absolute paths, and
// one shared rule turns them back into repo-relative ones — used both by the
// findings report on the way out and by the allowances matcher on the way in.
// A target outside that shape would make every allowance match nothing, which
// reads exactly like a feature nobody wired up.
test('paths inside a local target relativize by the same rule as a clone', () => {
  const src = gitRepo('relativize');
  write(src, 'config/dev.exs');
  git(src, 'add', '-A');
  git(src, 'commit', '--quiet', '-m', 'first');

  const tree = materialise(targetOf({ path: src }, 'billing', '/'), { prefix: 'billing' });
  try {
    assert.equal(relativize(path.join(tree.dir, 'config/dev.exs')), 'config/dev.exs');
  } finally {
    tree.cleanup();
  }
});

// A working copy is not a clone: it holds node_modules, build output and
// whatever else is ignored, and gitleaks, jscpd and the LOC walk would read all
// of it. What travels is what git carries.
test('ignored files stay behind and untracked-but-not-ignored ones come along', () => {
  const src = gitRepo('ignores');
  write(src, '.gitignore', 'node_modules/\n_build/\nsecret.env\n');
  write(src, 'lib/app.ex');
  write(src, 'node_modules/left-pad/index.js');
  write(src, '_build/dev/app.beam');
  write(src, 'secret.env', 'TOKEN=abc\n');
  git(src, 'add', '-A');
  git(src, 'commit', '--quiet', '-m', 'first');
  // Uncommitted, and not ignored: the edit you are about to push. Measuring the
  // committed state instead is the exact failure this feature exists to fix.
  write(src, 'lib/new_thing.ex');

  const tree = materialise(targetOf({ path: src }, 'billing', '/'), { prefix: 'billing' });
  try {
    const has = (p) => fs.existsSync(path.join(tree.dir, p));
    assert.ok(has('lib/app.ex'));
    assert.ok(has('lib/new_thing.ex'), 'an uncommitted file did not travel');
    assert.ok(has('.gitignore'));
    assert.ok(!has('node_modules/left-pad/index.js'));
    assert.ok(!has('_build/dev/app.beam'));
    assert.ok(!has('secret.env'), 'an ignored file travelled and would be scanned for secrets');
  } finally {
    tree.cleanup();
  }
});

// C1's change coupling needs a commit log and the copy has no .git. Rather than
// copy the object store, the log is read from the source — read-only.
test('history is read from the source folder, and the copy carries no git dir', () => {
  const src = gitRepo('history');
  write(src, 'lib/app.ex');
  git(src, 'add', '-A');
  git(src, 'commit', '--quiet', '-m', 'first');

  const tree = materialise(targetOf({ path: src }, 'billing', '/'), { prefix: 'billing' });
  try {
    assert.equal(tree.historyDir, src);
    assert.ok(!fs.existsSync(path.join(tree.dir, '.git')));
    // Reading it there actually works, which is the point of the pointer.
    assert.match(git(tree.historyDir, 'log', '--format=%s').toString(), /first/);
  } finally {
    tree.cleanup();
  }
});

test('a folder that is not a git repository is walked, says so, and has no history', () => {
  const src = tmpdir('plain');
  write(src, 'src/main.py');
  write(src, 'node_modules/dep/index.js');

  const tree = materialise(targetOf({ path: src }, 'billing', '/'), { prefix: 'billing' });
  try {
    assert.equal(tree.historyDir, null);
    assert.ok(fs.existsSync(path.join(tree.dir, 'src/main.py')));
    assert.ok(!fs.existsSync(path.join(tree.dir, 'node_modules/dep/index.js')));
    assert.ok(
      tree.notes.some((n) => /not a git repository/.test(n)),
      'nothing said that ignore rules could not be applied',
    );
  } finally {
    tree.cleanup();
  }
});

// Following one would read a file outside the tree being measured and attribute
// whatever it found to this system.
test('symlinks are skipped and counted rather than followed', () => {
  const outside = tmpdir('outside');
  write(outside, 'other-peoples-secrets.txt', 'AKIA0000\n');
  const src = gitRepo('symlink');
  write(src, 'lib/app.ex');
  fs.symlinkSync(path.join(outside, 'other-peoples-secrets.txt'), path.join(src, 'link.txt'));
  git(src, 'add', '-A');
  git(src, 'commit', '--quiet', '-m', 'first');

  const tree = materialise(targetOf({ path: src }, 'billing', '/'), { prefix: 'billing' });
  try {
    assert.ok(!fs.existsSync(path.join(tree.dir, 'link.txt')));
    assert.ok(tree.notes.some((n) => /1 symlinks skipped/.test(n)), tree.notes.join(' | '));
  } finally {
    tree.cleanup();
  }
});

// An empty tree measures clean on every criterion, which is the one outcome a
// scanner must never produce quietly.
test('an empty target is refused instead of scored', () => {
  const src = gitRepo('empty');
  assert.throws(
    () => materialise(targetOf({ path: src }, 'billing', '/'), { prefix: 'billing' }),
    /no files to scan .*scores clean on every criterion/s,
  );
});

test('a path that does not exist says so, and leaves no temp directory behind', () => {
  const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('scan-ghost-')).length;
  assert.throws(
    () => materialise(targetOf({ path: '/nowhere/at/all' }, 'ghost', '/'), { prefix: 'ghost' }),
    /does not exist/,
  );
  const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('scan-ghost-')).length;
  assert.equal(after, before, 'a failed materialise left its temp directory on disk');
});

test('a path that is a file, not a directory, is refused', () => {
  const src = tmpdir('afile');
  const file = write(src, 'notafolder.txt');
  assert.throws(
    () => materialise(targetOf({ path: file }, 'billing', '/'), { prefix: 'billing' }),
    /not a directory/,
  );
});

// The single most important property in this file. The clone path relies on
// cleanup to shred a .git/config holding a plaintext token; the local path must
// never be able to do the same thing to somebody's project.
test('cleanup removes the copy and never the folder it was copied from', () => {
  const src = gitRepo('survives');
  write(src, 'lib/app.ex');
  git(src, 'add', '-A');
  git(src, 'commit', '--quiet', '-m', 'first');

  const tree = materialise(targetOf({ path: src }, 'billing', '/'), { prefix: 'billing' });
  const work = path.dirname(tree.dir);
  tree.cleanup();

  assert.ok(!fs.existsSync(work), 'the temp tree survived cleanup');
  assert.ok(fs.existsSync(path.join(src, 'lib/app.ex')), 'cleanup deleted the source folder');
  assert.ok(fs.existsSync(path.join(src, '.git')), 'cleanup deleted the source git directory');
});

// --- the pieces -----------------------------------------------------------

test('the walk skips build and cache directories by name at any depth', () => {
  const src = tmpdir('walk');
  write(src, 'a.py');
  write(src, 'pkg/b.py');
  write(src, 'pkg/__pycache__/b.pyc');
  write(src, '.venv/lib/thing.py');
  const found = walkFiles(src).sort();
  assert.deepEqual(found, ['a.py', path.join('pkg', 'b.py')]);
});

// Not something git or the walk produces, so reaching it means the input is not
// what it claims to be.
test('a path escaping the source is not copied', () => {
  const src = tmpdir('escape-src');
  const dest = tmpdir('escape-dest');
  const sibling = tmpdir('escape-sibling');
  write(sibling, 'stolen.txt');
  write(src, 'kept.txt');

  const outward = path.join('..', path.basename(sibling), 'stolen.txt');
  const { copied } = copyFiles(src, dest, ['kept.txt', outward]);

  // Asserted by listing the destination rather than by probing one path:
  // path.join(dest, outward) resolves back out to the sibling itself, so
  // checking it does not exist would only prove the original is still there.
  assert.equal(copied, 1);
  assert.deepEqual(walkFiles(dest), ['kept.txt']);
});
