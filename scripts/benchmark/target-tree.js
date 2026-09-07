'use strict';

/*
 * Where a scan's working tree comes from.
 *
 * Every scan program used to do the same two lines: make a temp directory,
 * shallow-clone `cfg.repo` into `<tmp>/repo`. That is the only thing a target
 * could be, so running the scanner on a laptop scored whatever was on the
 * remote's default branch rather than the code in front of you — the check you
 * wanted to run before opening the pull request measured the branch you were
 * about to change.
 *
 * A system now declares `repo` OR `path`. Exactly one.
 *
 *   "billing": { "repo": "org/billing",   "stack": "elixir" }
 *   "billing": { "path": "code/billing",  "stack": "elixir" }
 *
 * A relative `path` is resolved against the DIRECTORY HOLDING THE CONFIG, not
 * the working directory. The config sits beside the projects it describes, and
 * resolving against the shell's cwd would make the same config mean different
 * things depending on where you happened to run it from. Nothing in this engine
 * is discovered by walking upwards, and this keeps it that way.
 *
 * A LOCAL TARGET IS COPIED, NOT SCANNED IN PLACE, and there are three separate
 * reasons — any one of them enough:
 *
 *   1. The scan writes into the tree it is reading. graphify drops a
 *      `graphify-out/` directory into the repo root. Scanning in place would
 *      leave build output inside somebody's working copy.
 *   2. Third-party scanners report absolute paths, and repo-paths.js turns them
 *      back into repo-relative ones by matching a `scan-<something>/repo/`
 *      prefix under the temp directory. That rule
 *      is shared with the allowances matcher, so a target outside that shape
 *      would make every allowance silently match nothing — which reads exactly
 *      like a feature nobody wired up. Materialising into the SAME shape means
 *      neither of those files has to learn about local targets at all.
 *   3. A working copy is not a clone. It holds `node_modules`, `_build`,
 *      coverage output and whatever else is gitignored, and gitleaks, jscpd and
 *      the LOC walk would all read them. The copy carries what git carries:
 *      tracked files plus untracked ones that are not ignored — which is to say
 *      the code you are about to push, uncommitted edits included. That is the
 *      thing you wanted measured.
 *
 * HISTORY IS READ FROM THE ORIGINAL. The copy has no `.git`, and C1's change
 * coupling needs a commit log. Rather than copy the object store, the scan is
 * handed a separate `historyDir` pointing at the source. It is only ever read
 * from — `git log`, nothing else. When the source is not a git repository at
 * all, `historyDir` is null and coupling reports itself unmeasured, which it
 * already knew how to do.
 *
 * NOTHING HERE EVER DELETES A DIRECTORY IT DID NOT CREATE. `cleanup()` removes
 * the temp directory and only the temp directory. The clone path relies on that
 * to shred a `.git/config` holding a plaintext token; the local path must never
 * be able to do the same thing to somebody's project.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// Only consulted when the source is not a git repository, and it is a guess by
// construction — without git there is no ignore file to obey. Kept deliberately
// short: these are directories that are build output or a package cache in
// every ecosystem that has them, and a wrong entry silently removes real source
// from a measurement. Anything doubtful is left in, because too much is a
// visible score and too little is an invisible one.
const NON_SOURCE_DIRS = new Set([
  '.git', 'node_modules', '_build', 'deps', '.venv', 'venv',
  '__pycache__', '.tox', '.gradle', '.terraform', 'graphify-out',
  '.next', '.nuxt', '.turbo', 'coverage', '.elixir_ls',
]);

/*
 * What a system config says its target is. Pure; no filesystem.
 *
 * configDir is where a relative path is resolved from — see the note above.
 */
function targetOf(cfg, systemKey, configDir) {
  const hasRepo = typeof cfg.repo === 'string' && cfg.repo !== '';
  const hasPath = typeof cfg.path === 'string' && cfg.path !== '';

  // Both is not a preference to resolve, it is two different answers to one
  // question. Silently choosing either would make a stale entry score the wrong
  // code, and the report would name the system, not the source.
  if (hasRepo && hasPath) {
    throw new Error(
      `System '${systemKey}' declares both repo and path. A target is one or the other — `
      + 'remove whichever is not the code you mean to measure.',
    );
  }
  if (!hasRepo && !hasPath) {
    throw new Error(
      `System '${systemKey}' declares neither repo nor path. `
      + 'Set repo to "owner/name" for a GitHub repository, or path to a folder on this machine.',
    );
  }

  if (hasRepo) return { kind: 'repo', repo: cfg.repo, label: cfg.repo };

  const resolved = path.resolve(configDir || process.cwd(), cfg.path);
  return { kind: 'path', path: resolved, label: resolved };
}

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, {
  encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...opts,
});

// The files git would carry: tracked, plus untracked ones no ignore rule
// covers. Returns null when the directory is not a git repository — the caller
// falls back to a walk and says that it did.
//
// `run` is injected so the listing can be tested without a git repository.
function gitFiles(srcDir, run = sh) {
  let out;
  try {
    out = run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: srcDir });
  } catch {
    return null;
  }
  return out.split('\0').filter(Boolean);
}

function walkFiles(srcDir) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 12) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (NON_SOURCE_DIRS.has(e.name)) continue;
        walk(path.join(dir, e.name), depth + 1);
      } else {
        found.push(path.relative(srcDir, path.join(dir, e.name)));
      }
    }
  };
  walk(srcDir, 0);
  return found;
}

/*
 * Copy a list of repo-relative paths from src into dest.
 *
 * Only regular files travel. A symlink is skipped and counted rather than
 * followed: following one would read a file outside the tree being measured and
 * attribute whatever it found to this system, and `git ls-files` lists symlinks
 * like anything else. The count is reported so a repository that leans on them
 * does not look like one that simply has fewer files.
 */
function copyFiles(src, dest, files) {
  let copied = 0;
  let symlinks = 0;
  let unreadable = 0;
  for (const rel of files) {
    // A path escaping the source is not something git or the walk produces, so
    // reaching this means the input is not what it claims to be.
    const from = path.resolve(src, rel);
    if (from !== src && !from.startsWith(src + path.sep)) continue;

    let st;
    try { st = fs.lstatSync(from); } catch { unreadable += 1; continue; }
    if (st.isSymbolicLink()) { symlinks += 1; continue; }
    if (!st.isFile()) continue;

    const to = path.join(dest, rel);
    try {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      copied += 1;
    } catch { unreadable += 1; }
  }
  return { copied, symlinks, unreadable };
}

/*
 * Produce a working tree for one system and say where it is.
 *
 * Returns { dir, historyDir, label, kind, cleanup, notes }.
 *
 *   dir         the tree to scan, always <tmp>/scan-<prefix>-<rand>/repo
 *   historyDir  where to run `git log` for change coupling, or null
 *   cleanup()   removes the temp directory and nothing else
 *   notes       lines worth printing; how the tree was assembled
 */
function materialise(target, {
  prefix, token, tmpRoot = os.tmpdir(), run = sh,
} = {}) {
  const work = fs.mkdtempSync(path.join(tmpRoot, `scan-${prefix}-`));
  const dir = path.join(work, 'repo');
  const cleanup = () => fs.rmSync(work, { recursive: true, force: true });
  const notes = [];

  try {
    if (target.kind === 'repo') {
      const url = token
        ? `https://x-access-token:${token}@github.com/${target.repo}.git`
        : `https://github.com/${target.repo}.git`;
      // Caught, because the URL carries the token and git writes it to its own
      // stderr on failure. Only the repo name is safe to put in the message.
      try {
        run('git', ['clone', '--depth', '1', url, dir]);
      } catch (err) {
        throw new Error(`git clone failed for ${target.repo} — check network and credentials (exit ${err.status})`);
      }
      return {
        dir, historyDir: dir, label: target.repo, kind: 'repo', cleanup, notes,
      };
    }

    let stat;
    try { stat = fs.statSync(target.path); } catch (err) {
      throw new Error(`target path for this system does not exist: ${target.path} (${err.code})`);
    }
    if (!stat.isDirectory()) throw new Error(`target path is not a directory: ${target.path}`);

    fs.mkdirSync(dir, { recursive: true });

    const tracked = gitFiles(target.path, run);
    const files = tracked || walkFiles(target.path);
    const historyDir = tracked ? target.path : null;
    if (!tracked) {
      notes.push(
        `${target.path} is not a git repository: copying everything outside a fixed list of `
        + 'build directories, and change coupling will be unmeasured',
      );
    }

    const { copied, symlinks, unreadable } = copyFiles(target.path, dir, files);

    // An empty tree measures clean on every criterion. That is the one outcome
    // a scanner must never produce quietly.
    if (copied === 0) {
      throw new Error(
        `no files to scan under ${target.path} — refusing to run, because an empty tree `
        + 'scores clean on every criterion',
      );
    }

    notes.push(
      `${copied} files copied from ${target.path}`
      + (tracked ? ' (tracked and untracked, ignore rules applied)' : '')
      + (symlinks ? `; ${symlinks} symlinks skipped` : '')
      + (unreadable ? `; ${unreadable} unreadable` : ''),
    );

    return {
      dir, historyDir, label: target.path, kind: 'path', cleanup, notes,
    };
  } catch (err) {
    cleanup();
    throw err;
  }
}

module.exports = {
  targetOf, materialise, gitFiles, walkFiles, copyFiles, NON_SOURCE_DIRS,
};
