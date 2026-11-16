'use strict';

/*
 * Step 1: divide a repository into areas, one auditor each.
 *
 * An area is only a STARTING point. Auditors follow an agreement wherever its
 * other side lives, so the split decides where attention begins, not what can be
 * found. What matters is that every part of the repository is someone's start,
 * and that no auditor starts with far more than the others.
 *
 * Rules, in order:
 *   - root files and operations directories (CI, docker, scripts, docs, infra)
 *     form one "config and operations" area. In the back-tests that area found
 *     the most breakages of any.
 *   - everything else is keyed by its top directory, one level deeper inside
 *     monorepo folders (apps/web, packages/shared).
 *   - the largest keys get their own area; the rest share one.
 *   - while there is room, an area far larger than average is split in two by
 *     its next directory level.
 */

const fs = require('node:fs');
const path = require('node:path');

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage', '_build', 'deps', 'vendor']);
const OPS_TOP = new Set([
  '.github', '.circleci', '.gitlab', '.husky', 'docker', 'scripts', 'bin', 'docs', 'infra', 'deploy', 'k8s',
  'helm', 'terraform', 'config', '.devcontainer',
]);
const NEST_TOP = new Set(['apps', 'packages', 'services', 'libs', 'modules']);
const SOURCE_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.ex', '.exs', '.rb', '.py', '.go', '.java',
  '.kt', '.cs', '.php', '.rs', '.swift', '.sql', '.prisma', '.graphql',
]);
const CONFIG_AREA = 'config and operations';
const REST_AREA = 'everything else';

function collectFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile()) out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  walk(root);
  return out.sort();
}

function keyOf(file) {
  const parts = file.split('/');
  if (parts.length === 1 || OPS_TOP.has(parts[0])) return CONFIG_AREA;
  if (NEST_TOP.has(parts[0]) && parts.length > 2) return `${parts[0]}/${parts[1]}`;
  return parts[0];
}

const isSource = (file) => SOURCE_EXT.has(path.extname(file));

function group(files, keyFn) {
  const map = new Map();
  for (const f of files) {
    const k = keyFn(f);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(f);
  }
  return map;
}

function areaOf(name, paths, files) {
  return { name, paths, files: files.length, source: files.filter(isSource).length, _files: files };
}

// Splits one area into two by the first directory level below it that actually
// branches (apps/api/src/domains/* rather than the lone apps/api/src), balancing
// source files.
function splitInTwo(area) {
  if (area.paths.length !== 1) return null;
  const base = area.paths[0].split('/').length;
  let sub = null;
  for (let depth = base + 1; depth <= base + 4; depth += 1) {
    const candidate = group(area._files.filter((f) => f.split('/').length > depth), (f) => f.split('/').slice(0, depth).join('/'));
    if (candidate.size >= 2) { sub = candidate; break; }
  }
  if (!sub) return null;
  const loose = area._files.filter((f) => ![...sub.values()].some((list) => list.includes(f)));
  if (loose.length) sub.set(area.paths[0], loose);
  const parts = [...sub.entries()].sort((a, b) => b[1].filter(isSource).length - a[1].filter(isSource).length);
  const bins = [[], []];
  const weight = [0, 0];
  for (const [p, fs2] of parts) {
    const i = weight[0] <= weight[1] ? 0 : 1;
    bins[i].push([p, fs2]);
    weight[i] += fs2.filter(isSource).length;
  }
  if (!bins[1].length) return null;
  return bins.map((bin, i) => areaOf(
    `${area.name} (${i + 1} of 2)`,
    bin.map(([p]) => p).sort(),
    bin.flatMap(([, f]) => f),
  ));
}

function splitAreas(files, { maxAreas = 9 } = {}) {
  if (!files.length) throw new Error('no files to audit');
  const byKey = group(files, keyOf);
  const configFiles = byKey.get(CONFIG_AREA) || [];
  byKey.delete(CONFIG_AREA);

  const keyed = [...byKey.entries()]
    .map(([k, f]) => areaOf(k, [k], f))
    .sort((a, b) => b.source - a.source || a.name.localeCompare(b.name));

  const room = Math.max(1, maxAreas - (configFiles.length ? 1 : 0));
  let areas = keyed;
  if (keyed.length > room) {
    const own = keyed.slice(0, room - 1);
    const rest = keyed.slice(room - 1);
    areas = [...own, areaOf(REST_AREA, rest.map((a) => a.name).sort(), rest.flatMap((a) => a._files))];
  }

  // Split oversized areas while there is room.
  for (;;) {
    if (areas.length >= room) break;
    const biggest = areas.filter((a) => a.name !== REST_AREA).sort((a, b) => b.source - a.source)[0];
    const others = areas.filter((a) => a !== biggest);
    const avgOthers = others.length ? others.reduce((s, a) => s + a.source, 0) / others.length : 0;
    if (!biggest || biggest.source < 40 || biggest.source < 2 * avgOthers) break;
    const halves = splitInTwo(biggest);
    if (!halves) break;
    areas = areas.filter((a) => a !== biggest).concat(halves);
  }

  if (configFiles.length) {
    const opsDirs = [...new Set(configFiles.map((f) => (f.includes('/') ? f.split('/')[0] : '(root files)')))].sort();
    areas.push(areaOf(CONFIG_AREA, opsDirs, configFiles));
  }
  return areas.map(({ _files, ...a }) => a);
}

module.exports = { collectFiles, splitAreas, keyOf, CONFIG_AREA, REST_AREA };
