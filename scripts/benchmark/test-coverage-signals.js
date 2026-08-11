'use strict';

// Pure helpers for C6 Test Coverage: file classification (source vs test per
// stack), test<->source pairing, and coverage-tooling + threshold detection.
// No I/O — the scan edge (scan-test-coverage.js) reads files and calls these.
// Pairing is basename-stem based (a file-presence proxy, NOT line coverage);
// the precise per-unit map is a post-MVP C1 code-graph enhancement.

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
  SKIP_DIRS, aggregateStack, detectThresholds, detectTool,
};
