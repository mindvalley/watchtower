'use strict';

// Pure helpers for C6 Test Coverage: file classification (source vs test per
// stack), test<->source pairing, and coverage-tooling + threshold detection.
// No I/O — the scan edge (scan-test-coverage.js) reads files and calls these.
// Pairing is by basename stem; where the code graph is trusted, the same-named
// test must also import the file. Neither is line coverage.

const SKIP_DIRS = new Set([
  'node_modules', 'deps', '_build', '.git', '.elixir_ls', 'tmp', 'vendor',
  'priv', '.agents', 'cover', 'coverage', 'dist', 'build',
]);

const norm = (p) => String(p).replace(/\\/g, '/');

function sourceStem(relPath) {
  return norm(relPath).split('/').pop().replace(/\.(ex|rb|js|ts|jsx|tsx|vue|py)$/, '');
}

function testStem(relPath) {
  let s = norm(relPath).split('/').pop()
    .replace(/_test\.exs$/, '')
    .replace(/_(test|spec)\.rb$/, '')
    .replace(/\.(test|spec)\.(js|ts|jsx|tsx)$/, '');
  if (/\.py$/.test(s)) s = s.replace(/\.py$/, '').replace(/^test_/, '').replace(/_test$/, '');
  return s;
}

function aggregateStack(sourcePaths, testPaths, sampleCap = 20) {
  const testStems = new Set(testPaths.map(testStem));
  const untested = [];
  let tested = 0;
  for (const s of sourcePaths) {
    if (testStems.has(sourceStem(s))) tested += 1;
    else if (untested.length < sampleCap) untested.push(norm(s));
  }
  return { source_files: sourcePaths.length, tested_files: tested, untested_samples: untested };
}

// A source file is tested when a test named for it imports it. `importsByTest`
// maps each test path to the set of files the code graph says it depends on.
function aggregateStackByImports(sourcePaths, testPaths, importsByTest, sampleCap = 20) {
  const testsByStem = new Map();
  for (const t of testPaths) {
    const stem = testStem(t);
    if (!testsByStem.has(stem)) testsByStem.set(stem, []);
    testsByStem.get(stem).push(norm(t));
  }
  const untested = [];
  let tested = 0;
  let creditedByNameOnly = 0;
  for (const s of sourcePaths) {
    const src = norm(s);
    const named = testsByStem.get(sourceStem(src)) || [];
    if (named.some((t) => importsByTest.get(t)?.has(src))) tested += 1;
    else {
      if (named.length) creditedByNameOnly += 1;
      if (untested.length < sampleCap) untested.push(src);
    }
  }
  return {
    source_files: sourcePaths.length,
    tested_files: tested,
    untested_samples: untested,
    credited_by_name_only: creditedByNameOnly,
  };
}

// Of the source files that have a same-named test, the share where the graph
// also sees that test import the file. Below the threshold the graph is not
// resolving this repo's test imports, so import pairing would under-count.
const IMPORT_RESOLUTION_THRESHOLD = 0.5;

function choosePairing(byImports, byName) {
  const namedPairs = byImports.tested_files + byImports.credited_by_name_only;
  const rate = namedPairs ? Number((byImports.tested_files / namedPairs).toFixed(4)) : 0;
  const importResolution = {
    named_pairs: namedPairs, imported: byImports.tested_files, rate, threshold: IMPORT_RESOLUTION_THRESHOLD,
  };
  if (namedPairs && rate >= IMPORT_RESOLUTION_THRESHOLD) {
    return { ...byImports, pairing: 'imports', import_resolution: importResolution };
  }
  return {
    ...byName,
    pairing: 'filename',
    import_resolution: importResolution,
    pairing_fallback: `the code graph sees the import for ${byImports.tested_files} of ${namedPairs} same-named test pairs `
      + `(below ${IMPORT_RESOLUTION_THRESHOLD * 100}%), so a same-named test counts`,
  };
}

function detectThresholds(text) {
  const out = [];
  // `target:` is anchored (not preceded by a word char/./-) so a coverage
  // `target: 80%` matches but a compound key like `bundle_size_target: 90`
  // does not — otherwise any *_target key would forge an enforced threshold.
  const re = /(?:minimum[_-]?coverage["']?\s*[:=]?\s*|SimpleCov\.minimum_coverage\s+|(?<![\w.-])target:\s*|--cov-fail-under[=\s]+)(\d{1,3})\b/gi;
  let m;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(String(text)))) {
    const v = Number(m[1]);
    if (v > 0 && v <= 100) out.push(v);
  }
  return out;
}

function detectTool(stack, text) {
  const t = String(text);
  // Primary discipline signal is coverage ENFORCEMENT via GitHub Actions (gates every
  // PR), independent of stack or coverage library. cobertura-action is one such
  // gate; in the repos measured it covers both Elixir and frontend in place of
  // a language-specific coverage tool.
  if (/cobertura-action/i.test(t)) return 'cobertura-action';
  if (stack === 'elixir') {
    // "coveralls" catches excoveralls (dep), a coveralls.json file, and a `mix coveralls` CI task.
    if (/coveralls/i.test(t) || /test_coverage:\s*\[tool:\s*ExCoveralls/i.test(t)) return 'excoveralls';
  } else if (stack === 'ruby') {
    if (/simplecov/i.test(t)) return 'simplecov';
  } else if (stack === 'frontend') {
    if (/vitest|jest|nyc\b|\bc8\b|@vitest\/coverage/i.test(t)) return 'vitest/jest';
  } else if (stack === 'python') {
    if (/pytest-cov|coverage\.py|--cov\b|\bcov=|codecov/i.test(t)) return 'coverage.py';
  }
  return null;
}

module.exports = {
  SKIP_DIRS, aggregateStack, aggregateStackByImports, choosePairing, IMPORT_RESOLUTION_THRESHOLD,
  detectThresholds, detectTool,
};
