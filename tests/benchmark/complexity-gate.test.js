'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { detectGate, readConfig, LINTER_DEFAULT_THRESHOLD } = require('../../scripts/benchmark/complexity-gate');

const FIXTURE = (...parts) => path.join(__dirname, 'fixtures', ...parts);

const CREDO_ON = '%{configs: [%{checks: %{enabled: [{Credo.Check.Refactor.CyclomaticComplexity, []}]}}]}';
const CREDO_MAX_12 = '%{configs: [%{checks: %{enabled: [{Credo.Check.Refactor.CyclomaticComplexity, [max_complexity: 12]}]}}]}';

test('no config and no workflow is rung none', () => {
  const r = detectGate({ language: 'elixir', configs: {}, workflowText: '' });
  assert.strictEqual(r.rung, 'none');
  assert.strictEqual(r.threshold, null);
});

test('a credo config with the check enabled but no CI step is configured, not enforced', () => {
  const r = detectGate({ language: 'elixir', configs: { credo: CREDO_ON }, workflowText: 'jobs:\n  test:\n    steps:\n      - run: mix test' });
  assert.strictEqual(r.rung, 'configured');
});

test('a credo config plus a mix credo CI step is enforced at the credo default', () => {
  const r = detectGate({ language: 'elixir', configs: { credo: CREDO_ON }, workflowText: '      - name: Check credo\n        run: mix credo --all' });
  assert.strictEqual(r.rung, 'enforced');
  assert.strictEqual(r.threshold, LINTER_DEFAULT_THRESHOLD.credo);
});

test('an explicit max_complexity overrides the linter default', () => {
  const r = detectGate({ language: 'elixir', configs: { credo: CREDO_MAX_12 }, workflowText: '        run: mix credo' });
  assert.strictEqual(r.threshold, 12);
});

test('a continue-on-error step is configured, not enforced', () => {
  const workflowText = '      - name: Check credo\n        run: mix credo --all\n        continue-on-error: true';
  const r = detectGate({ language: 'elixir', configs: { credo: CREDO_ON }, workflowText });
  assert.strictEqual(r.rung, 'configured', 'a non-failing step does not gate anything');
});

test('rubocop with the cop enabled and a CI step is enforced at its Max', () => {
  const rubocop = 'Metrics/CyclomaticComplexity:\n  Enabled: true\n  Max: 10\n';
  const r = detectGate({ language: 'ruby', configs: { rubocop }, workflowText: '        run: bundle exec rubocop' });
  assert.strictEqual(r.rung, 'enforced');
  assert.strictEqual(r.threshold, 10);
});

test('a disabled rubocop cop is not a gate even with a CI step', () => {
  const rubocop = 'Metrics/CyclomaticComplexity:\n  Enabled: false\n';
  const r = detectGate({ language: 'ruby', configs: { rubocop }, workflowText: '        run: bundle exec rubocop' });
  assert.strictEqual(r.rung, 'none');
});

test('an eslint complexity rule with a numeric option reads that number', () => {
  const eslint = '{ "rules": { "complexity": ["error", 15] } }';
  const r = detectGate({ language: 'javascript', configs: { eslint }, workflowText: '        run: npm run lint' });
  assert.strictEqual(r.rung, 'enforced');
  assert.strictEqual(r.threshold, 15);
});

test('an eslint complexity rule with no number falls back to the eslint default', () => {
  const eslint = '{ "rules": { "complexity": "error" } }';
  const r = detectGate({ language: 'javascript', configs: { eslint }, workflowText: '        run: npm run lint' });
  assert.strictEqual(r.threshold, LINTER_DEFAULT_THRESHOLD.eslint);
});

test('an eslint config with the rule off is not a gate', () => {
  const eslint = '{ "rules": { "complexity": "off" } }';
  const r = detectGate({ language: 'javascript', configs: { eslint }, workflowText: '        run: npm run lint' });
  assert.strictEqual(r.rung, 'none');
});

test('a language with no relevant linter config reads none regardless of other languages CI', () => {
  const r = detectGate({ language: 'typescript', configs: { credo: CREDO_ON }, workflowText: '        run: mix credo' });
  assert.strictEqual(r.rung, 'none', 'an elixir gate says nothing about typescript');
});

test('evidence names what was found so the score is inspectable', () => {
  const r = detectGate({ language: 'elixir', configs: { credo: CREDO_ON }, workflowText: '        run: mix credo --all' });
  assert.match(r.evidence, /credo/i);
});

// Fix 1 & 2: continue-on-error scoping to the YAML step block
test('continue-on-error before run: in same step is configured, not enforced', () => {
  const workflowText = '      - name: Check credo\n        continue-on-error: true\n        run: mix credo --all';
  const r = detectGate({ language: 'elixir', configs: { credo: CREDO_ON }, workflowText });
  assert.strictEqual(r.rung, 'configured', 'flag before run: still belongs to this step');
});

test('a neighbouring step with continue-on-error does not demote a clean step', () => {
  const workflowText = '      - name: Check credo\n        run: mix credo --all\n      - name: Other step\n        continue-on-error: true\n        run: echo hi';
  const r = detectGate({ language: 'elixir', configs: { credo: CREDO_ON }, workflowText });
  assert.strictEqual(r.rung, 'enforced', 'a neighbouring step flag must not affect this step');
});

// Fix 3: credo disabled: block must not be credited as a gate
const CREDO_DISABLED = '%{configs: [%{checks: %{disabled: [{Credo.Check.Refactor.CyclomaticComplexity, []}]}}]}';

test('a credo check in the disabled block is not a gate', () => {
  const r = detectGate({ language: 'elixir', configs: { credo: CREDO_DISABLED }, workflowText: '        run: mix credo' });
  assert.strictEqual(r.rung, 'none', 'an explicitly disabled check must not be credited as a gate');
});

// Fix 4: ESLint flat config (unquoted keys) — multi-line format (key at line start)
test('eslint flat config unquoted key with a numeric option reads that number', () => {
  const eslint = "export default [\n  {\n    rules: {\n      complexity: ['error', 15]\n    }\n  }\n]";
  const r = detectGate({ language: 'javascript', configs: { eslint }, workflowText: '        run: npm run lint' });
  assert.strictEqual(r.rung, 'enforced');
  assert.strictEqual(r.threshold, 15);
});

test('eslint flat config unquoted key with no number falls back to the eslint default', () => {
  const eslint = "export default [\n  {\n    rules: {\n      complexity: 'error'\n    }\n  }\n]";
  const r = detectGate({ language: 'javascript', configs: { eslint }, workflowText: '        run: npm run lint' });
  assert.strictEqual(r.threshold, LINTER_DEFAULT_THRESHOLD.eslint);
});

// Fix 5: ESLint [0, N] severity-zero is not a gate
test('eslint severity zero in array form is not a gate', () => {
  const eslint = '{ "rules": { "complexity": [0, 5] } }';
  const r = detectGate({ language: 'javascript', configs: { eslint }, workflowText: '        run: npm run lint' });
  assert.strictEqual(r.rung, 'none');
});

// Round 2 fix 1: step-block scoping — first step regression
test('linter in the first step of a job is not demoted by continue-on-error in a later step', () => {
  const workflowText = 'jobs:\n  lint:\n    steps:\n      - run: mix credo\n      - name: Other\n        continue-on-error: true\n        run: echo hi';
  const r = detectGate({ language: 'elixir', configs: { credo: CREDO_ON }, workflowText });
  assert.strictEqual(r.rung, 'enforced', 'a later step flag must not reach back to the first step');
});

test('linter in the last step has a correctly bounded block with no following step', () => {
  const workflowText = '      - name: Other step\n        run: echo hi\n      - name: Check credo\n        run: mix credo --all';
  const r = detectGate({ language: 'elixir', configs: { credo: CREDO_ON }, workflowText });
  assert.strictEqual(r.rung, 'enforced', 'last step with no following item must be enforced');
});

// Round 2 fix 2: unquoted ESLint key must not match prose in comments
test('eslint complexity in a line comment is not a gate', () => {
  const eslint = '// complexity: too strict, revisit later\nexport default [{ rules: {} }]';
  const r = detectGate({ language: 'javascript', configs: { eslint }, workflowText: '        run: npm run lint' });
  assert.strictEqual(r.rung, 'none', 'a rule name in a line comment must not be counted as configured');
});

test('eslint complexity in a block comment is not a gate', () => {
  const eslint = '/* complexity: disabled for now */\nexport default [{ rules: {} }]';
  const r = detectGate({ language: 'javascript', configs: { eslint }, workflowText: '        run: npm run lint' });
  assert.strictEqual(r.rung, 'none', 'a rule name in a block comment must not be counted as configured');
});

// Round 3: real-repo fixtures — flat list form vs map form
test('real Bravo .credo.exs (flat checks list) reads enabled at max_complexity 15', () => {
  const text = fs.readFileSync(FIXTURE('phoenix-flat-list.credo.exs'), 'utf8');
  const cfg = readConfig('credo', text);
  assert.strictEqual(cfg.enabled, true, 'flat checks list must be treated as enabled');
  assert.strictEqual(cfg.threshold, 15);
});

test('real alpha .credo.exs (map checks form with enabled: key) reads enabled at the linter default', () => {
  const text = fs.readFileSync(FIXTURE('umbrella-map-form.credo.exs'), 'utf8');
  const cfg = readConfig('credo', text);
  assert.strictEqual(cfg.enabled, true, 'enabled: key form must still be detected correctly');
  assert.strictEqual(cfg.threshold, null, 'no explicit max_complexity means threshold falls back to default');
});

test('a check in a flat list with false as second arg is not a gate', () => {
  // This is the credo flat-list form of disabling a check, distinct from the map form
  const text = '%{configs: [%{checks: [{Credo.Check.Refactor.CyclomaticComplexity, false}]}]}';
  const cfg = readConfig('credo', text);
  assert.strictEqual(cfg.enabled, false, 'false as second arg in flat list disables the check');
});

// ---------------------------------------------------------------------------
// Flat-config detection (C3)
//
// readGateInputs at the scan edge selected an ESLint config only when its text
// matched /["']complexity["']/ — quoted keys only. The unquoted branch in
// readConfig was therefore reachable from these unit tests and from nowhere else:
// in production a repo writing the canonical ESLint v9 flat config
// `complexity: ["error", 10]` read rung none / gate 0, costing roughly a full
// point of C8. A false RED is publish-blocking exactly as a false green is.
// The edge now shares mentionsEslintComplexityRule with the detector.
// ---------------------------------------------------------------------------

const {
  mentionsEslintComplexityRule, ESLINT_CONFIG_CANDIDATES,
} = require('../../scripts/benchmark/complexity-gate');

test('the edge selector sees the unquoted flat-config key the detector reads', () => {
  const flat = 'export default [{ rules: {\n    complexity: ["error", 10],\n  } }];';
  assert.strictEqual(mentionsEslintComplexityRule(flat), true, 'the edge must select this file');
  assert.deepStrictEqual(readConfig('eslint', flat), { enabled: true, threshold: 10 });
});

test('the edge selector and the detector agree on every spelling', () => {
  const cases = [
    '{"rules": {"complexity": ["error", 12]}}',
    "module.exports = { rules: { 'complexity': [2, 8] } };",
    'export default [{ rules: { complexity: ["error", 15] } }];',
    'rules:\n  complexity:\n    - error\n    - 9\n',
  ];
  for (const text of cases) {
    assert.strictEqual(mentionsEslintComplexityRule(text), true, `selector missed: ${text}`);
    assert.strictEqual(readConfig('eslint', text).enabled, true, `detector missed: ${text}`);
  }
});

test('single-line inline flat config is detected (the line-start anchor missed it)', () => {
  // `{ complexity: ['error', 15] }` all on one line: the old ^\s* anchor could
  // never match it, so a repo gating at 15 read as ungated.
  const oneLine = "export default [{ files: ['**/*.js'], rules: { complexity: ['error', 15] } }];";
  assert.strictEqual(mentionsEslintComplexityRule(oneLine), true);
  assert.deepStrictEqual(readConfig('eslint', oneLine), { enabled: true, threshold: 15 });
});

test('single-line inline flat config with the rule turned off reads disabled', () => {
  const off = "export default [{ rules: { complexity: 'off', eqeqeq: 'error' } }];";
  assert.deepStrictEqual(readConfig('eslint', off), { enabled: false, threshold: null });
});

test('an unquoted key is enabled at the eslint default when no number is given', () => {
  const on = "export default [{ rules: { complexity: 'error' } }];";
  const r = detectGate({ language: 'javascript', configs: { eslint: on }, workflowText: '' });
  assert.strictEqual(r.rung, 'configured');
  assert.strictEqual(r.threshold, LINTER_DEFAULT_THRESHOLD.eslint);
});

test('similar rule names are not mistaken for the complexity rule', () => {
  for (const text of [
    "export default [{ rules: { 'sonarjs/cognitive-complexity': ['error', 15] } }];",
    'export default [{ rules: { maxComplexity: 10 } }];',
    'const opts = { obj.complexity: 3 };',
  ]) {
    assert.strictEqual(mentionsEslintComplexityRule(text), false, `false positive on: ${text}`);
  }
});

test('a commented-out rule is still not a gate', () => {
  const commented = '// complexity: ["error", 10]\nexport default [{ rules: {} }];';
  assert.strictEqual(mentionsEslintComplexityRule(commented), false);
  assert.deepStrictEqual(readConfig('eslint', commented), { enabled: false, threshold: null });
});

test('the candidate list covers YAML rc files and every flat-config extension', () => {
  for (const f of ['.eslintrc.yml', '.eslintrc.yaml', 'eslint.config.cjs', 'eslint.config.ts']) {
    assert.ok(ESLINT_CONFIG_CANDIDATES.includes(f), `${f} must be a candidate config`);
  }
});

test('a YAML .eslintrc gates at its configured maximum', () => {
  const yaml = 'rules:\n  complexity: [error, 8]\n  no-console: warn\n';
  assert.strictEqual(mentionsEslintComplexityRule(yaml), true);
  assert.deepStrictEqual(readConfig('eslint', yaml), { enabled: true, threshold: 8 });
});

// ---------------------------------------------------------------------------
// Credo comments (#55)
//
// The eslint branch strips comments before reading; the credo branch did not,
// and it reads raw text at three separate decision points. Elixir comments run
// from `#` to end of line, and `mix credo.gen.config` emits a long check list
// that people routinely comment out entries in — so commented text reaching the
// detector is the normal case, not a contrived one.
//
// The check-name lookup is the dangerous one: it is a false GREEN. A repo that
// commented the cyclomatic check out has no gate, and scoring it as enforced
// credits protection that does not exist. The other two can err either way.
// ---------------------------------------------------------------------------

test('a commented-out credo check is not a gate', () => {
  // The false-green vector: indexOf found the commented occurrence and read it
  // as a live check, crediting a gate to a repo that had switched it off.
  const text = [
    '%{configs: [%{checks: %{enabled: [',
    '  # {Credo.Check.Refactor.CyclomaticComplexity, [max_complexity: 12]},',
    '  {Credo.Check.Readability.ModuleDoc, []}',
    ']}}]}',
  ].join('\n');
  assert.deepStrictEqual(
    readConfig('credo', text),
    { enabled: false, threshold: null },
    'a check that exists only inside a comment must not be counted as configured',
  );
});

test('a comment mentioning disabled: does not switch off a live credo check', () => {
  // lastIndexOf('disabled:') landed on prose sitting after the real enabled:
  // key, flipping an enforced gate to none — about a point of C8, a false red.
  const text = [
    '%{configs: [%{checks: %{enabled: [',
    '  # checks below were disabled: in 2024 and brought back the following year',
    '  {Credo.Check.Refactor.CyclomaticComplexity, []}',
    ']}}]}',
  ].join('\n');
  assert.deepStrictEqual(
    readConfig('credo', text),
    { enabled: true, threshold: null },
    'prose in a comment must not outrank the real enabled: key',
  );
});

test('a commented max_complexity does not become the threshold', () => {
  // The threshold regex scanned the whole file rather than the check, so a
  // commented-out number anywhere outranked the live one.
  const text = [
    '%{configs: [%{checks: %{enabled: [',
    '  # was max_complexity: 25 before the cleanup',
    '  {Credo.Check.Refactor.CyclomaticComplexity, [max_complexity: 12]}',
    ']}}]}',
  ].join('\n');
  assert.deepStrictEqual(
    readConfig('credo', text),
    { enabled: true, threshold: 12 },
    'the live threshold must win over one left behind in a comment',
  );
});

test('a # inside a credo string does not truncate the config', () => {
  // Guard on the fix itself: over-stripping is the failure mode a naive
  // strip-to-end-of-line introduces. Elixir configs carry quoted globs and
  // regex sigils, and a `#` can legally sit inside one.
  const text = [
    '%{configs: [%{',
    '  files: %{included: ["lib/", "priv/#hash/"]},',
    '  checks: %{enabled: [{Credo.Check.Refactor.CyclomaticComplexity, [max_complexity: 11]}]}',
    '}]}',
  ].join('\n');
  assert.deepStrictEqual(
    readConfig('credo', text),
    { enabled: true, threshold: 11 },
    'a # within a string must not swallow the rest of the config',
  );
});
