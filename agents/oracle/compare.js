'use strict';

/*
 * Step 5: follow findings from one run to the next.
 *
 * Each run writes its findings from scratch, in a model's words, and sees about
 * two thirds of what is there. So a finding cannot be followed by its text or
 * its fingerprint (the files it names), and a finding missing from this run has
 * usually not been fixed: the run just did not see it. This module keeps the
 * bookkeeping honest:
 *
 *   - A model pairs the previous run's open findings with this run's by meaning;
 *     a paired finding keeps its id. (`applyMatches`)
 *   - An earlier finding not found again is carried forward as open if none of
 *     its files changed; only if one did is it re-checked against the code.
 *     (`splitUnmatched`, `changedFiles`)
 *   - Nothing is closed (fixed, guarded, broke) without a re-check saying so.
 *
 * Ids: a finding's id is its fingerprint in the run that first saw it, made
 * unique against every id ever handed out (changes.json → issued_ids), closed
 * ones included. It never changes after that, so it can label pull requests.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { placeFiles } = require('./fingerprint');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function uniqueId(base, taken) {
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

// Earliest sighting first; the id breaks ties so the choice is deterministic.
const older = (a, b) => String(a.first_seen?.run || '').localeCompare(String(b.first_seen?.run || ''))
  || String(a.id).localeCompare(String(b.id));

/*
 * The previous run's open findings: what it reported plus what it carried
 * forward. A run from before ids existed is read with its fingerprints as ids.
 */
function loadPreviousOpen(runDir) {
  const run = readJson(path.join(runDir, 'run.json'));
  const stamp = path.basename(runDir);
  const { findings = [] } = readJson(path.join(runDir, 'findings.json'));
  const changesFile = path.join(runDir, 'changes.json');
  const changes = fs.existsSync(changesFile) ? readJson(changesFile) : {};
  const carried = changes.carried || [];
  const issued = new Set(changes.issued_ids || []);
  const open = [...findings, ...carried].map((f) => ({
    ...f,
    id: f.id || uniqueId(f.fingerprint, issued),
    first_seen: f.first_seen || { run: stamp, commit: run.commit || null },
  }));
  open.forEach((f) => issued.add(f.id));
  return { dir: runDir, run: stamp, commit: run.commit || null, open, issued };
}

/*
 * Applies the model's matches. `matches` is [{ current: 'C<n>', previous: ['P<n>', …] }]
 * with 1-based positions into `current` and `previousOpen`; anything malformed or
 * unknown is ignored. Sets id, first_seen and change on every current finding.
 *
 * Returns { outcomes, unmatched }: an outcome for each earlier finding that was
 * found again (still_open, or merged into another id), and the earlier findings
 * that were not.
 */
function applyMatches({ previousOpen, current, matches, run, commit, issued = new Set() }) {
  const prevAt = (ref) => previousOpen[Number(String(ref).replace(/^P/, '')) - 1];
  const curAt = (ref) => current[Number(String(ref).replace(/^C/, '')) - 1];

  const claims = new Map(); // current finding -> earlier findings it matches
  for (const m of matches || []) {
    const cur = m && /^C\d+$/.test(m.current) ? curAt(m.current) : undefined;
    if (!cur || !Array.isArray(m.previous)) continue;
    const prevs = m.previous.filter((p) => /^P\d+$/.test(p)).map(prevAt).filter(Boolean);
    if (prevs.length) claims.set(cur, [...new Set([...(claims.get(cur) || []), ...prevs])]);
  }

  const taken = new Set([...issued, ...previousOpen.map((f) => f.id)]);
  const inherited = new Map(); // earlier id -> current finding that kept it
  const outcomes = new Map();
  const refound = new Set();

  for (const cur of current) {
    const prevs = (claims.get(cur) || []).sort(older);
    prevs.forEach((p) => refound.add(p));
    const keeper = prevs.find((p) => !inherited.has(p.id));
    if (keeper) {
      inherited.set(keeper.id, cur);
      Object.assign(cur, { id: keeper.id, first_seen: keeper.first_seen, change: 'still_open' });
      outcomes.set(keeper.id, { id: keeper.id, status: 'still_open', refound: true, by: keeper.id });
    } else {
      Object.assign(cur, { id: uniqueId(cur.fingerprint, taken), first_seen: { run, commit }, change: prevs.length ? 'split' : 'new' });
      if (prevs.length) cur.split_from = prevs[0].id;
    }
  }
  // Earlier findings matched only alongside an older one that kept its id are
  // duplicates of it: merged, not fixed.
  for (const cur of current) {
    for (const p of claims.get(cur) || []) {
      if (!outcomes.has(p.id)) outcomes.set(p.id, { id: p.id, status: 'merged', refound: true, by: cur.id });
    }
  }

  return {
    outcomes: previousOpen.filter((p) => outcomes.has(p.id)).map((p) => outcomes.get(p.id)),
    unmatched: previousOpen.filter((p) => !refound.has(p)),
  };
}

/*
 * Earlier findings not found again: carried forward if none of their files
 * changed, re-checked if one did. `changed` null means unknown — then every
 * one is re-checked rather than assumed unchanged.
 */
// A place as a path to compare with changed files: quotes and a line anchor
// dropped, a trailing slash kept so a folder is matched by what is inside it.
const placePath = (file) => file.replace(/^[`'"]+|[`'"]+$/g, '').replace(/#.*$/, '');

function hitsOf(places, changed) {
  const hits = new Set();
  for (const raw of placeFiles(places)) {
    const p = placePath(raw);
    if (!p) continue;
    if (changed.has(p)) hits.add(p);
    if (p.endsWith('/')) for (const c of changed) if (c.startsWith(p)) hits.add(c);
  }
  return [...hits].sort();
}

function splitUnmatched(unmatched, changed) {
  const carried = [];
  const recheck = [];
  for (const f of unmatched) {
    if (!changed) { recheck.push({ ...f, changed_files: null }); continue; }
    const hit = hitsOf(f.places, changed);
    if (hit.length) recheck.push({ ...f, changed_files: hit });
    else carried.push(f);
  }
  return { carried, recheck };
}

/*
 * Files that differ between `fromCommit` and the tree as it is on disk (so a
 * local folder's uncommitted edits count), relative to `dir` like the places
 * findings name; null when that cannot be told.
 *
 * `fetch: true` only for Oracle's own shallow clone, which does not hold the
 * earlier commit: it is fetched one deep. A local folder target is the user's
 * own and is only read, never fetched into — shallow or not.
 */
function changedFiles(dir, fromCommit, { fetch = false } = {}) {
  if (!dir || !fromCommit) return null;
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    try {
      git('cat-file', '-e', `${fromCommit}^{commit}`);
    } catch {
      if (!fetch) return null;
      git('fetch', '-q', '--depth', '1', 'origin', fromCommit);
    }
    const out = git('diff', '--name-only', '-z', '--relative', '--no-renames', fromCommit);
    return new Set(out.split('\0').filter(Boolean));
  } catch {
    return null;
  }
}

module.exports = { applyMatches, splitUnmatched, loadPreviousOpen, changedFiles, uniqueId };
