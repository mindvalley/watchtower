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

// An area is a list of parts, each a [label, files] pair. Labels are what the
// auditor is told to start from; the files are what the area covers. Splitting
// always works on the parts, so no file can fall out of every area.
function areaOf(name, parts) {
  const files = parts.flatMap(([, f]) => f);
  return {
    name, paths: parts.map(([p]) => p).sort(), files: files.length, source: files.filter(isSource).length, _files: files, _parts: parts,
  };
}

const sourceCount = (files) => files.filter(isSource).length;

// Puts [label, files] parts into two bins of roughly equal source size.
function balance(parts) {
  const bins = [[], []];
  const weight = [0, 0];
  for (const part of [...parts].sort((a, b) => sourceCount(b[1]) - sourceCount(a[1]))) {
    const i = weight[0] <= weight[1] ? 0 : 1;
    bins[i].push(part);
    weight[i] += sourceCount(part[1]);
  }
  return bins[1].length ? bins : null;
}

// Splits one area in two. A group of folders is split as a group. A single
// folder is split where it actually branches: step down past any child that holds
// most of the source (apps/api -> apps/api/src -> apps/api/src/domains), keeping
// what was stepped past as "other files", and divide the children there.
function splitInTwo(area) {
  if (area._parts.length > 1) {
    const bins = balance(area._parts);
    return bins && bins.map((bin, i) => areaOf(`${area.name}, part ${i + 1}`, bin));
  }

  let prefix = area.paths[0];
  const stepped = [];
  for (let guard = 0; guard < 8; guard += 1) {
    const depth = prefix.split('/').length + 1;
    const inside = area._files.filter((f) => f.startsWith(`${prefix}/`) && f.split('/').length > depth);
    const kids = group(inside, (f) => f.split('/').slice(0, depth).join('/'));
    const others = area._files.filter((f) => !inside.includes(f) && !stepped.includes(f));
    if (kids.size === 0) return null;
    const ranked = [...kids.entries()].sort((a, b) => sourceCount(b[1]) - sourceCount(a[1]));
    const total = sourceCount(inside) + sourceCount(others);
    if (kids.size === 1 || sourceCount(ranked[0][1]) > 0.8 * total) {
      stepped.push(...others, ...ranked.slice(1).flatMap(([, f]) => f));
      [prefix] = ranked[0];
      continue;
    }
    const bins = balance(ranked);
    if (!bins) return null;
    const rest = [...stepped, ...others];
    if (rest.length) {
      const lighter = sourceCount(bins[0].flatMap(([, f]) => f)) <= sourceCount(bins[1].flatMap(([, f]) => f)) ? 0 : 1;
      bins[lighter].push([`${area.paths[0]} (other files)`, rest]);
    }
    return bins.map((bin, i) => areaOf(`${area.name} (${i + 1} of 2)`, bin));
  }
  return null;
}

function splitAreas(files, { maxAreas = 9 } = {}) {
  if (!files.length) throw new Error('no files to audit');
  const byKey = group(files, keyOf);
  const configFiles = byKey.get(CONFIG_AREA) || [];
  byKey.delete(CONFIG_AREA);

  const keyed = [...byKey.entries()]
    .map(([k, f]) => areaOf(k, [[k, f]]))
    .sort((a, b) => b.source - a.source || a.name.localeCompare(b.name));

  const room = Math.max(1, maxAreas - (configFiles.length ? 1 : 0));
  // A folder with a small share of the source does not get an auditor of its
  // own; slots go to splitting the big ones instead.
  const totalSource = keyed.reduce((s, a) => s + a.source, 0);
  const minOwn = Math.max(20, totalSource * 0.04);
  let own = keyed.filter((a) => a.source >= minOwn).slice(0, room - 1);
  if (!own.length) own = keyed.slice(0, 1);
  const rest = keyed.filter((a) => !own.includes(a));
  let areas = rest.length
    ? [...own, areaOf(REST_AREA, rest.flatMap((a) => a._parts))]
    : own;

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
    const byDir = group(configFiles, (f) => (f.includes('/') ? f.split('/')[0] : '(root files)'));
    areas.push(areaOf(CONFIG_AREA, [...byDir.entries()]));
  }
  return areas.map(({ _files, _parts, ...a }) => a);
}

module.exports = { collectFiles, splitAreas, keyOf, CONFIG_AREA, REST_AREA };
