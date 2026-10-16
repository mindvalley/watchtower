'use strict';

// Ranks the places under a remedial action (complex functions, untested files)
// by how many files use them and how often they changed. Ordering only: no
// score reads anything here.

const { relativize } = require('./repo-paths');
const { isTestOrFixturePath, isNonSourcePath, SOURCE_EXT } = require('./boundary-signals');
const { boundaryGraphDisposition } = require('./criterion-stacks');

const START_WITH_COUNT = 3;

function changeCounts(revisions) {
  const counts = new Map();
  for (const r of revisions || []) {
    for (const f of new Set(r.files)) counts.set(f, (counts.get(f) || 0) + 1);
  }
  return counts;
}

const isPlace = (f) => (SOURCE_EXT.test(f) || f.endsWith('.vue')) && !isNonSourcePath(f);

// Tests importing a file say nothing about how widely the product relies on it.
// A file that defines nothing (a barrel of re-exports) is not credited.
function directDependents(deps, definers = null) {
  const counts = new Map();
  for (const [source, targets] of deps || []) {
    if (isTestOrFixturePath(source)) continue;
    for (const t of targets) {
      if (definers && !definers.has(t)) continue;
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  return counts;
}

// graphify gives every file one node of its own; any further node is something
// the file defines.
function definingFiles(graph) {
  const nodes = new Map();
  for (const n of (graph && graph.nodes) || []) {
    if (n.source_file) nodes.set(n.source_file, (nodes.get(n.source_file) || 0) + 1);
  }
  return new Set([...nodes].filter(([, count]) => count > 1).map(([f]) => f));
}

function buildHotspots({ deps = null, definers = null, revisions = null, windowDays, graphUnavailable = null }) {
  const dependents = directDependents(deps, definers);
  const changes = changeCounts(revisions);
  const files = {};
  for (const f of [...new Set([...dependents.keys(), ...changes.keys()])].filter(isPlace).sort()) {
    files[f] = { dependents: dependents.get(f) || 0, changes: changes.get(f) || 0 };
  }
  return {
    window_days: windowDays,
    graph: deps ? 'built' : graphUnavailable || 'not built',
    history: revisions ? 'read' : 'unavailable',
    files,
  };
}

function weightOf(hotspots, file, useDependents) {
  const h = hotspots.files[relativize(file)] || {};
  return ((useDependents ? h.dependents || 0 : 0) + 1) * ((h.changes || 0) + 1);
}

function rankPlaces(items, hotspots, { useDependents, fileOf = (it) => it.file } = {}) {
  if (!hotspots) return items;
  return items
    .map((item, i) => ({ item, i, w: weightOf(hotspots, fileOf(item), useDependents) }))
    .sort((a, b) => b.w - a.w || a.i - b.i)
    .map((x) => x.item);
}

// "Used by" counts come from the code graph, trusted on the same terms as C1.
function rankingFor(sys, hotspots) {
  return {
    hotspots: hotspots || null,
    useDependents: !!hotspots && hotspots.graph === 'built' && boundaryGraphDisposition(sys.stack) === 'ok',
  };
}

// A file with no dependents and no changes carries no signal and is never named.
function startWith(rankedItems, hotspots, { useDependents, fileOf = (it) => it.file } = {}) {
  if (!hotspots) return null;
  const files = [];
  for (const item of rankedItems) {
    const f = relativize(fileOf(item));
    if (!f || files.includes(f) || weightOf(hotspots, f, useDependents) <= 1) continue;
    files.push(f);
    if (files.length === START_WITH_COUNT) break;
  }
  if (!files.length) return null;
  const basis = useDependents ? 'the most used and most changed' : 'the most changed';
  return `Start with ${basis}: ${files.join(', ')}.`;
}

module.exports = {
  changeCounts, directDependents, definingFiles, buildHotspots, rankPlaces, rankingFor, startWith, START_WITH_COUNT,
};
