'use strict';

// Change coupling (Tornhill's "logical coupling") aggregated at module level.
//
// Two modules are change-coupled when they keep being edited in the same commit.
// That is behavioural evidence of a dependency, and unlike a code graph it does
// not depend on resolving a single symbol correctly -- which is why C1 uses it on
// stacks where the extractor under-resolves.
//
// The metric, its formula and its thresholds are code-maat's, the reference
// implementation. We reimplement it over `git log` rather than shipping the JVM
// jar, so we can aggregate at module level directly instead
// of file-level-then-roll-up. Only the implementation is ours; the definition and
// the anchor are established.
//
//   degree of coupling = shared revisions / AVERAGE revisions of the two modules
//
// The average denominator is code-maat's, verified in
// src/code_maat/analysis/logical_coupling.clj: "the number of shared revisions
// divided by the average number of revisions for the two coupled modules". An
// earlier draft of our spec said "the less-active member", which inflates the
// degree on asymmetric pairs and would have broken the anchor.

const { moduleForFile, isNonSourcePath } = require('./boundary-signals');

// code-maat's published command-line defaults, read from cmd_line.clj. These are
// the anchor: a published tool default, the same class of basis as McCabe <= 10.
// Not tuned, not chosen by us -- changing one is a methodology change.
const CODE_MAAT_DEFAULTS = Object.freeze({
  minRevs: 5, // -n: a module needs this many revisions to be considered at all
  minSharedRevs: 5, // -m: a pair needs this many co-changes
  minCoupling: 30, // -i: degree percentage below which a pair is coincidence
  maxChangesetSize: 30, // -s: commits touching more modules than this are swept, not coupled
});

// Dependency lockfiles move for reasons that have nothing to do with the module
// owning them -- a single `pnpm up` rewrites every lockfile in the workspace and
// would couple every module to every other. Excluded from the coupling signal.
const LOCKFILES = new Set([
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'npm-shrinkwrap.json',
  'mix.lock', 'Gemfile.lock', 'poetry.lock', 'uv.lock', 'Cargo.lock',
  'composer.lock', 'go.sum', 'Pipfile.lock',
]);

function isLockfile(p) {
  return LOCKFILES.has(String(p).slice(String(p).lastIndexOf('/') + 1));
}

// Parse `git log --no-merges --format=commit%x09%H --name-only`. Each record is a
// header line carrying the sha followed by the touched paths, one per line.
function parseGitLog(text) {
  const revisions = [];
  let current = null;
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('commit\t')) {
      if (current && current.files.length) revisions.push(current);
      current = { sha: line.slice('commit\t'.length).trim(), files: [] };
      continue;
    }
    if (!line.trim()) continue;
    if (current) current.files.push(line.trim());
  }
  if (current && current.files.length) revisions.push(current);
  return revisions;
}

// Reduce each revision to the DISTINCT declared modules it touched. Revisions
// that touch more modules than the changeset cap are dropped, and the number
// dropped is returned so the bound is visible rather than silent.
function modulesPerRevision(revisions, modules, { maxChangesetSize } = CODE_MAAT_DEFAULTS) {
  const cap = maxChangesetSize == null ? CODE_MAAT_DEFAULTS.maxChangesetSize : maxChangesetSize;
  const out = [];
  let excluded = 0;
  for (const rev of revisions) {
    const touched = new Set();
    for (const f of rev.files) {
      if (isNonSourcePath(f) || isLockfile(f)) continue;
      const m = moduleForFile(f, modules);
      if (m) touched.add(m);
    }
    if (touched.size > cap) { excluded += 1; continue; }
    out.push({ sha: rev.sha, modules: [...touched].sort() });
  }
  return { revisions: out, excluded_oversized_changesets: excluded };
}

// Count revisions per module and co-changes per pair, then apply code-maat's
// three filters. Returns the coupled pairs plus the counts a reader needs to
// judge whether the repo had enough history to say anything at all.
function couplingPairs(revisions, options = {}) {
  const {
    minRevs = CODE_MAAT_DEFAULTS.minRevs,
    minSharedRevs = CODE_MAAT_DEFAULTS.minSharedRevs,
    minCoupling = CODE_MAAT_DEFAULTS.minCoupling,
  } = options;

  const revsByModule = new Map();
  const sharedByPair = new Map();

  for (const rev of revisions) {
    const mods = [...new Set(rev.modules)].sort();
    for (const m of mods) revsByModule.set(m, (revsByModule.get(m) || 0) + 1);
    for (let i = 0; i < mods.length; i += 1) {
      for (let j = i + 1; j < mods.length; j += 1) {
        const key = `${mods[i]}\u0000${mods[j]}`;
        sharedByPair.set(key, (sharedByPair.get(key) || 0) + 1);
      }
    }
  }

  const qualifying = [...revsByModule.entries()].filter(([, n]) => n >= minRevs);
  const qualifyingNames = new Set(qualifying.map(([m]) => m));

  const pairs = [];
  for (const [key, shared] of sharedByPair) {
    const [a, b] = key.split('\u0000');
    if (!qualifyingNames.has(a) || !qualifyingNames.has(b)) continue;
    if (shared < minSharedRevs) continue;
    const revsA = revsByModule.get(a);
    const revsB = revsByModule.get(b);
    // code-maat truncates the percentage rather than rounding it.
    const degree = Math.trunc((shared / ((revsA + revsB) / 2)) * 100);
    if (degree < minCoupling) continue;
    pairs.push({ a, b, revs_a: revsA, revs_b: revsB, shared_revs: shared, degree });
  }

  pairs.sort((x, y) => y.degree - x.degree || (x.a < y.a ? -1 : 1));

  return {
    pairs,
    qualifying_modules: qualifying.length,
    total_revisions: revisions.length,
  };
}

module.exports = {
  parseGitLog, modulesPerRevision, couplingPairs, CODE_MAAT_DEFAULTS, isLockfile,
};
