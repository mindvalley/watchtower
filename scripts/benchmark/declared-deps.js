'use strict';

// What each module DECLARES it depends on, read from the repo's own manifests.
//
// This is the breadcrumb half of C1's cross-boundary metric. Change coupling says
// which modules actually move together; this says which of those movements the
// repo has admitted to. A pair that co-changes with no declared dependency in
// either direction is a hidden coupling -- the criterion's own words.
//
// Deliberately NOT read from the code graph. The graph under-resolves Elixir
// badly enough that a missing edge would manufacture a violation, which is the
// trap this whole metric exists to avoid. A manifest is a statement the repo
// makes about itself, in the same spirit as declaration-driven module discovery.

// Discovery kinds where the ecosystem HAS a per-module dependency declaration.
// Namespaces inside one application (source-namespace) have no such mechanism,
// so "undeclared" would be true of every pair by construction and would carry no
// information. Those repos are reported, never graded, on this metric.
const DECLARABLE_KINDS = ['elixir-umbrella', 'pnpm-workspace', 'npm-workspace', 'uv-workspace', 'sibling-projects'];

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function basename(prefix) {
  return prefix.replace(/\/$/, '').split('/').pop();
}

// ─── Per-ecosystem manifest readers ──────────────────────────────────────────
//
// Each returns { name, deps } -- the module's own package name and the names it
// declares a dependency on -- or null when the manifest could not be read. A
// null is surfaced to the caller, never silently treated as "declares nothing":
// that would turn an unreadable manifest into a violation for every pair.

function readPackageJson(text) {
  let pkg;
  try { pkg = JSON.parse(text); } catch { return null; }
  if (!pkg || typeof pkg !== 'object') return null;
  const deps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
    ...Object.keys(pkg.peerDependencies || {}),
    ...Object.keys(pkg.optionalDependencies || {}),
  ];
  return { name: pkg.name || null, deps };
}

// `{:dep, in_umbrella: true}` is the only inter-app form; a hex dep is a version
// string and is not an edge between modules.
function readMixExs(text) {
  const deps = [];
  for (const m of String(text).matchAll(/\{\s*:([a-z_][a-zA-Z0-9_]*)\s*,[^}]*in_umbrella:\s*true/g)) {
    deps.push(m[1]);
  }
  return { name: null, deps };
}

// `[project] name` plus the `dependencies` array. Requirement strings carry
// version specifiers and extras; the package name is the leading token.
function readPyProject(text) {
  const t = String(text);
  const nameMatch = t.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
  const depsMatch = t.match(/^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m);
  const deps = depsMatch
    ? [...depsMatch[1].matchAll(/["']([^"']+)["']/g)]
      .map((m) => m[1].split(/[\s<>=!~;[]/)[0].trim())
      .filter(Boolean)
    : [];
  return { name: nameMatch ? nameMatch[1] : null, deps };
}

const READER_BY_FILE = {
  'package.json': readPackageJson,
  'mix.exs': readMixExs,
  'pyproject.toml': readPyProject,
};

// Which manifest actually governs a module is decided by the DISCOVERY KIND, not
// by whichever file is found first. An Elixir app routinely carries its own
// package.json for asset building -- apps/<app>/package.json in an umbrella -- and
// first-match would read that instead of mix.exs, lose every umbrella dependency,
// and report declared pairs as hidden couplings. Same family as the C6 trap where
// Phoenix's assets/package.json was promoted to a module.
//
// sibling-projects is the one shape that is genuinely mixed: each top-level
// directory may be its own ecosystem, so there we union whatever is present.
const MANIFESTS_BY_KIND = {
  'elixir-umbrella': ['mix.exs'],
  'pnpm-workspace': ['package.json'],
  'npm-workspace': ['package.json'],
  'uv-workspace': ['pyproject.toml'],
  'sibling-projects': ['package.json', 'mix.exs', 'pyproject.toml'],
};

function declaredDependencyPairs({ files, readText, modules, kind }) {
  const declared = new Set();
  const unreadable = [];
  if (!DECLARABLE_KINDS.includes(kind)) {
    return { declared, declarable: false, unreadable, resolved_modules: 0 };
  }

  const fileSet = new Set(files || []);
  const parsed = new Map(); // module name -> { name, deps }

  const manifestNames = MANIFESTS_BY_KIND[kind] || [];
  for (const mod of modules || []) {
    let got = null;
    let sawManifest = false;
    for (const file of manifestNames) {
      const path = `${mod.prefix}${file}`;
      if (!fileSet.has(path)) continue;
      sawManifest = true;
      const text = readText(path);
      if (text == null) continue;
      const parsedOne = READER_BY_FILE[file](text);
      if (!parsedOne) continue;
      // Union across manifests for the mixed sibling-projects shape; for every
      // other kind there is exactly one governing manifest.
      got = got
        ? { name: got.name || parsedOne.name, deps: [...got.deps, ...parsedOne.deps] }
        : parsedOne;
    }
    // A module with no manifest at all is simply not a declaring unit; a module
    // whose manifest exists but could not be parsed is reported, because
    // treating it as "declares nothing" would make every one of its pairs a
    // violation.
    if (!got) { if (sawManifest) unreadable.push(mod.name); continue; }
    // An Elixir app's identity is its directory name -- mix.exs states the app
    // atom, but the umbrella resolves `in_umbrella` deps by directory.
    const identity = got.name || basename(mod.prefix);
    parsed.set(mod.name, { identity, deps: got.deps });
  }

  // Index every module by the name other modules would use to depend on it.
  const moduleByIdentity = new Map();
  for (const [modName, { identity }] of parsed) moduleByIdentity.set(identity, modName);
  // Elixir deps are referenced by directory name even when a package name exists.
  for (const mod of modules || []) {
    const base = basename(mod.prefix);
    if (!moduleByIdentity.has(base)) moduleByIdentity.set(base, mod.name);
  }

  for (const [modName, { deps }] of parsed) {
    for (const dep of deps) {
      const target = moduleByIdentity.get(dep);
      if (!target || target === modName) continue;
      declared.add(pairKey(modName, target));
    }
  }

  return { declared, declarable: true, unreadable, resolved_modules: parsed.size };
}

module.exports = { declaredDependencyPairs, pairKey, DECLARABLE_KINDS };
