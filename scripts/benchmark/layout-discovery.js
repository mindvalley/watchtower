'use strict';

// layout-discovery.js — agnostic C6 file classification. Pure (no fs). Maps each
// repo-relative path to {stack, role} (source|test|null) using universal layout
// conventions on the FULL repo-relative path.
//
// Design note (why no manifest-root discovery): an earlier design discovered
// project roots from declared manifests (package.json/mix.exs/pyproject.toml/…)
// and classified root-relative. Investigation against the real repos proved that
// harmful: Phoenix apps ship an `assets/package.json`, which made `assets/` a
// root — stripping the `assets/` prefix so the `(src|assets)/` matcher missed
// every `assets/js/*.js` (one Phoenix frontend collapsed 124 → 0). The universal
// convention regexes already use `(^|/)…`, so they traverse monorepo nesting
// (`apps/web/src/x.ts`, `libraries/core/src/x.py`) natively — no root logic
// needed. Being the same regexes the pilot used, they reproduce the five
// byte-identical. The agnostic conventions ARE the discovery.

const norm = (p) => String(p).replace(/\\/g, '/');

// Classify a repo-relative path. Tests are checked before sources (a test file
// shares source extensions). Language is only a reporting bucket, never a
// scoring input. Buckets: elixir, ruby, frontend (all JS/TS), python.
function classifyFile(relPath) {
  const p = norm(relPath);

  // Tests first.
  if (/(^|\/)test\/.*_test\.exs$/.test(p)) return { stack: 'elixir', role: 'test' };
  if (/(^|\/)spec\/.*_spec\.rb$/.test(p) || /(^|\/)test\/.*_test\.rb$/.test(p)) return { stack: 'ruby', role: 'test' };
  // __tests__/ is a JS/TS convention; carve out .py so a python test under it
  // reaches the python branch instead of being counted as a frontend test.
  if (/\.(test|spec)\.(js|ts|jsx|tsx)$/.test(p) || (/(^|\/)__tests__\//.test(p) && !/\.py$/.test(p))) return { stack: 'frontend', role: 'test' };
  if (/(^|\/)(test_[^/]+|[^/]+_test)\.py$/.test(p)) return { stack: 'python', role: 'test' };

  // Sources.
  if (/(^|\/)lib\/.*\.ex$/.test(p)) return { stack: 'elixir', role: 'source' };
  if (/(^|\/)(app|lib)\/.*\.rb$/.test(p)) return { stack: 'ruby', role: 'source' };
  if (/\.(js|ts|jsx|tsx|vue)$/.test(p) && !/\.(test|spec|config|conf)\./.test(p) && !/\.d\.ts$/.test(p) && /(^|\/)(src|assets)\//.test(p)) {
    return { stack: 'frontend', role: 'source' };
  }
  if (/(^|\/)(src|lib)\/.*\.py$/.test(p)) return { stack: 'python', role: 'source' };

  return { stack: null, role: null };
}

module.exports = { classifyFile };
