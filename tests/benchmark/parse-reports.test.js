const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseGitleaks, parseTrivy, parseSast, extractDeps,
  parseCredo, parseRubocop, parseDuplication, parseLizard, complexityParser, extractLinterJson,
} = require('../../scripts/benchmark/parse-reports');

test('parseGitleaks counts findings from the gitleaks array shape', () => {
  const report = [
    { Description: 'AWS key', File: 'config/prod.exs', RuleID: 'aws-access-token' },
    { Description: 'Generic', File: 'apps/web/.env', RuleID: 'generic-api-key' },
  ];
  const r = parseGitleaks(report);
  assert.strictEqual(r.secrets, 2);
  assert.deepStrictEqual(r.items[0], { description: 'AWS key', file: 'config/prod.exs', rule: 'aws-access-token' });
});

test('parseGitleaks treats null / non-array as zero', () => {
  const zero = {
    secrets: 0, raw_secrets: 0, triaged_secrets: 0, confirmed_secrets: 0,
    review_secrets: 0, excluded_by_path: 0, items: [], review_items: [],
  };
  assert.deepStrictEqual(parseGitleaks(null), zero);
  assert.deepStrictEqual(parseGitleaks({ nope: 1 }), zero);
});

test('parseGitleaks splits confirmed (hard-cap) from review-bucket rules', () => {
  const report = [
    { Description: 'aws', File: 'config/prod.exs', RuleID: 'aws-access-token' },
    { Description: 'pem', File: 'priv/static/k.pem', RuleID: 'private-key' },
    { Description: 'ga tag', File: 'config/prod.exs', RuleID: 'generic-api-key' },
    { Description: 'client id', File: 'config/config.exs', RuleID: 'generic-api-key' },
    { Description: 'fixture', File: 'test/fixtures/x.exs', RuleID: 'aws-access-token' },
  ];
  const r = parseGitleaks(report, {
    excludePaths: ['**/test/**'],
    reviewRules: ['generic-api-key'],
  });
  assert.strictEqual(r.raw_secrets, 5);
  assert.strictEqual(r.excluded_by_path, 1); // the fixture
  assert.strictEqual(r.triaged_secrets, 4); // 2 confirmed + 2 review
  assert.strictEqual(r.confirmed_secrets, 2); // aws + private-key → hard-cap
  assert.strictEqual(r.review_secrets, 2); // generic-api-key → review only
  assert.strictEqual(r.secrets, 2, 'secrets (hard-cap count) reflects confirmed only');
  assert.deepStrictEqual(r.items.map((i) => i.rule), ['aws-access-token', 'private-key']);
  assert.deepStrictEqual(r.review_items.map((i) => i.rule), ['generic-api-key', 'generic-api-key']);
});

test('parseGitleaks separates raw from triaged using path excludes', () => {
  const report = [
    { Description: 'real', File: 'config/prod.exs', RuleID: 'aws-access-token' },
    { Description: 'fixture', File: 'apps/web/test/fixtures/data.json', RuleID: 'generic-api-key' },
    { Description: 'cassette', File: 'spec/cassette_library/vcr.yml', RuleID: 'generic-api-key' },
    { Description: 'seed', File: 'priv/data/seed/asset/a.json', RuleID: 'generic-api-key' },
    { Description: 'mock', File: 'apps/api/__mocks__/x.js', RuleID: 'generic-api-key' },
  ];
  const excludePaths = [
    '**/test/**', '**/tests/**', '**/spec/**', '**/__mocks__/**',
    '**/fixtures/**', '**/priv/data/seed/**', '**/cassette_library/**',
  ];
  const r = parseGitleaks(report, { excludePaths });
  assert.strictEqual(r.raw_secrets, 5);
  assert.strictEqual(r.triaged_secrets, 1);
  assert.strictEqual(r.excluded_by_path, 4);
  assert.strictEqual(r.secrets, 1, 'downstream `secrets` reflects the triaged count');
  assert.deepStrictEqual(r.items.map((i) => i.file), ['config/prod.exs']);
});

test('parseGitleaks with no excludes keeps every finding (raw === triaged)', () => {
  const report = [{ Description: 'x', File: 'lib/a.ex', RuleID: 'r' }];
  const r = parseGitleaks(report);
  assert.strictEqual(r.raw_secrets, 1);
  assert.strictEqual(r.triaged_secrets, 1);
  assert.strictEqual(r.excluded_by_path, 0);
  assert.strictEqual(r.secrets, 1);
});

test('parseTrivy tallies raw; findings with no known direct dep fall to transitive', () => {
  const report = { Results: [
    { Target: 'mix.lock', Vulnerabilities: [
      { VulnerabilityID: 'CVE-1', Severity: 'CRITICAL' },
      { VulnerabilityID: 'CVE-2', Severity: 'HIGH' },
      { VulnerabilityID: 'CVE-3', Severity: 'HIGH' },
      { VulnerabilityID: 'CVE-4', Severity: 'UNKNOWN' },
    ] },
    { Target: 'apps/web/assets/package-lock.json', Vulnerabilities: [
      { VulnerabilityID: 'CVE-5', Severity: 'MEDIUM' },
      { VulnerabilityID: 'CVE-6', Severity: 'LOW' },
    ] },
    { Target: 'Gemfile.lock' }, // no Vulnerabilities key
  ] };
  const zero = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
  const tallied = { critical: 1, high: 2, medium: 1, low: 1, total: 5 };
  // No PkgName and no dep lists → everything is transitive/unattributable.
  const r = parseTrivy(report);
  assert.deepStrictEqual(r.raw, tallied);
  assert.deepStrictEqual(r.prod, zero);
  assert.deepStrictEqual(r.dev, zero);
  assert.deepStrictEqual(r.transitive, tallied);
  assert.strictEqual(r.items.length, 5); // CRITICAL, HIGH, HIGH, MEDIUM, LOW (UNKNOWN skipped)
});

test('parseTrivy classifies by direct prod/dev deps; the rest is transitive', () => {
  const report = { Results: [
    { Target: 'mix.lock', Vulnerabilities: [
      { VulnerabilityID: 'CVE-1', Severity: 'CRITICAL', PkgName: 'phoenix_storybook' }, // direct prod
      { VulnerabilityID: 'CVE-2', Severity: 'CRITICAL', PkgName: '@vitest/browser' }, // direct dev
      { VulnerabilityID: 'CVE-3', Severity: 'HIGH', PkgName: 'plug' }, // direct prod
    ] },
    { Target: 'apps/web/assets/package-lock.json', Vulnerabilities: [
      { VulnerabilityID: 'CVE-4', Severity: 'HIGH', PkgName: 'minimatch' }, // transitive
      { VulnerabilityID: 'CVE-5', Severity: 'MEDIUM' }, // transitive (no PkgName)
    ] },
  ] };
  const r = parseTrivy(report, {
    prodDeps: ['phoenix_storybook', 'plug'],
    devDeps: ['@vitest/browser'],
  });
  assert.deepStrictEqual(r.raw, { critical: 2, high: 2, medium: 1, low: 0, total: 5 });
  assert.deepStrictEqual(r.prod, { critical: 1, high: 1, medium: 0, low: 0, total: 2 });
  assert.deepStrictEqual(r.dev, { critical: 1, high: 0, medium: 0, low: 0, total: 1 });
  assert.deepStrictEqual(r.transitive, { critical: 0, high: 1, medium: 1, low: 0, total: 2 });
});

test('parseTrivy treats null as zero across all buckets', () => {
  const zero = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
  const r = parseTrivy(null);
  assert.deepStrictEqual(r.raw, zero);
  assert.deepStrictEqual(r.prod, zero);
  assert.deepStrictEqual(r.dev, zero);
  assert.deepStrictEqual(r.transitive, zero);
  assert.deepStrictEqual(r.items, []);
});

test('extractDeps splits direct Hex + npm deps into prod and dev', () => {
  const mixExs = `
    defp deps do
      [
        {:phoenix, "~> 1.7"},
        {:phoenix_storybook, "~> 0.9"},
        {:credo, "~> 1.7", only: [:dev, :test], runtime: false},
        {:ex_machina, "~> 2.7", only: :test},
        {:tool_all_env, "~> 1.0", only: [:dev, :test, :prod]},
      ]
    end
  `;
  const packageJsons = [
    { dependencies: { vue: '2.7.0' }, devDependencies: { '@vitest/browser': '1.0.0', eslint: '8.0.0' } },
  ];
  const { prod, dev } = extractDeps({ mixExs, packageJsons });
  // phoenix_storybook has no `only:` → prod; tool_all_env includes :prod → prod
  assert.deepStrictEqual(prod.sort(), ['phoenix', 'phoenix_storybook', 'tool_all_env', 'vue'].sort());
  assert.deepStrictEqual(dev.sort(), ['@vitest/browser', 'credo', 'eslint', 'ex_machina'].sort());
});

test('extractDeps tolerates missing inputs', () => {
  assert.deepStrictEqual(extractDeps({}), { prod: [], dev: [] });
  assert.deepStrictEqual(extractDeps({ mixExs: null, packageJsons: [] }), { prod: [], dev: [] });
});

test('parseSast(semgrep) maps ERROR/WARNING/INFO and metadata CRITICAL', () => {
  const report = { results: [
    { check_id: 'a', extra: { severity: 'ERROR', metadata: { severity: 'CRITICAL' } } },
    { check_id: 'b', extra: { severity: 'ERROR' } },
    { check_id: 'c', extra: { severity: 'WARNING' } },
    { check_id: 'd', extra: { severity: 'INFO' } },
  ] };
  const banded = { critical: 1, high: 1, medium: 1, low: 1, total: 4 };
  const r = parseSast(report, 'semgrep');
  assert.deepStrictEqual(r.raw, banded);
  assert.deepStrictEqual(r.triaged, banded);
  assert.strictEqual(r.remapped, 0);
  assert.strictEqual(r.excluded_by_path, 0);
  assert.strictEqual(r.items.length, 4);
});

test('parseSast(semgrep) remaps by check_id leaf (handles --config auto doubled ids)', () => {
  // --config auto emits `<path>.<leaf>.<leaf>`; the remap config is keyed by leaf.
  const MUT = 'yaml.github-actions.security.github-actions-mutable-action-tag.github-actions-mutable-action-tag';
  const report = { results: [
    { check_id: MUT, path: '.github/workflows/ci.yml', extra: { severity: 'ERROR' } },
    { check_id: MUT, path: '.github/workflows/ci.yml', extra: { severity: 'ERROR' } },
    { check_id: 'x.real.sqli', path: 'lib/app.ex', extra: { severity: 'ERROR' } }, // real HIGH stays
    { check_id: 'y.warn', path: 'lib/b.ex', extra: { severity: 'WARNING' } },
  ] };
  const r = parseSast(report, 'semgrep', { severityRemap: { 'github-actions-mutable-action-tag': 'INFO' } });
  assert.deepStrictEqual(r.raw, { critical: 0, high: 3, medium: 1, low: 0, total: 4 });
  assert.deepStrictEqual(r.triaged, { critical: 0, high: 1, medium: 1, low: 2, total: 4 });
  assert.strictEqual(r.remapped, 2);
  assert.strictEqual(r.excluded_by_path, 0);
});

test('parseSast(semgrep) excludes findings in triaged paths (raw keeps them)', () => {
  const report = { results: [
    { check_id: 'g.detected-private-key', path: 'apps/api/test/fixtures/key.pem', extra: { severity: 'ERROR' } },
    { check_id: 'g.detected-private-key', path: 'spec/cassette_library/v.yml', extra: { severity: 'ERROR' } },
    { check_id: 'g.detected-private-key', path: 'apps/api/priv/static/certs/k.pem', extra: { severity: 'ERROR' } }, // real, kept
  ] };
  const r = parseSast(report, 'semgrep', { excludePaths: ['**/test/**', '**/cassette_library/**'] });
  assert.deepStrictEqual(r.raw, { critical: 0, high: 3, medium: 0, low: 0, total: 3 });
  assert.deepStrictEqual(r.triaged, { critical: 0, high: 1, medium: 0, low: 0, total: 1 });
  assert.strictEqual(r.excluded_by_path, 2);
});

test('parseSast(brakeman) maps confidence High/Medium/Weak', () => {
  const report = { warnings: [
    { confidence: 'High' }, { confidence: 'Medium' }, { confidence: 'Weak' }, { confidence: 'High' },
  ] };
  const banded = { critical: 0, high: 2, medium: 1, low: 1, total: 4 };
  const r = parseSast(report, 'brakeman');
  assert.deepStrictEqual(r.raw, banded);
  assert.deepStrictEqual(r.triaged, banded);
  assert.strictEqual(r.remapped, 0);
  assert.strictEqual(r.excluded_by_path, 0);
  assert.deepStrictEqual(r.items, []);
});

test('parseSast(sobelow) counts the confidence buckets', () => {
  const report = { findings: {
    high_confidence: [{ type: 'XSS' }, { type: 'SQL' }], medium_confidence: [{ type: 'CSRF' }], low_confidence: [],
  } };
  const banded = { critical: 0, high: 2, medium: 1, low: 0, total: 3 };
  const r = parseSast(report, 'sobelow');
  assert.deepStrictEqual(r.raw, banded);
  assert.deepStrictEqual(r.triaged, banded);
  assert.strictEqual(r.remapped, 0);
  assert.strictEqual(r.excluded_by_path, 0);
  assert.deepStrictEqual(r.items, []);
});

test('parseSast returns zero for unknown tool or null', () => {
  const zero = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
  const r1 = parseSast(null, 'semgrep');
  assert.deepStrictEqual(r1.raw, zero);
  assert.deepStrictEqual(r1.triaged, zero);
  assert.strictEqual(r1.remapped, 0);
  assert.strictEqual(r1.excluded_by_path, 0);
  assert.deepStrictEqual(r1.items, []);
  const r2 = parseSast({ results: [] }, 'mystery');
  assert.deepStrictEqual(r2.raw, zero);
  assert.deepStrictEqual(r2.triaged, zero);
  assert.strictEqual(r2.remapped, 0);
  assert.strictEqual(r2.excluded_by_path, 0);
  assert.deepStrictEqual(r2.items, []);
});

// ---- C8 Codebase Simplicity parsers -------------------------------------

test('parseCredo counts only CyclomaticComplexity issues and extracts CC', () => {
  const report = {
    issues: [
      { check: 'Credo.Check.Readability.ModuleDoc', message: 'Modules should have a @moduledoc tag.', filename: 'lib/a.ex', scope: 'A' },
      { check: 'Credo.Check.Refactor.CyclomaticComplexity', message: 'Function is too complex (cyclomatic complexity is 13, max is 10).', filename: 'lib/b.ex', line_no: 2, scope: 'B.big' },
      { check: 'Credo.Check.Refactor.Nesting', message: 'Function body is nested too deep.', filename: 'lib/c.ex', scope: 'C.f' },
      { check: 'Credo.Check.Refactor.CyclomaticComplexity', message: 'Function is too complex (cyclomatic complexity is 22, max is 10).', filename: 'lib/d.ex', scope: 'D.huge' },
    ],
  };
  const out = parseCredo(report);
  assert.strictEqual(out.tool, 'credo');
  assert.strictEqual(out.violations, 2);
  assert.deepStrictEqual(out.items[0], { scope: 'B.big', file: 'lib/b.ex', line: 2, cc: 13 });
  assert.strictEqual(out.items[1].cc, 22);
});

test('parseCredo degrades to zero on empty/garbage', () => {
  assert.strictEqual(parseCredo(null).violations, 0);
  assert.strictEqual(parseCredo({}).violations, 0);
  assert.strictEqual(parseCredo({ issues: 'nope' }).violations, 0);
});

test('parseRubocop counts Metrics/CyclomaticComplexity offenses and extracts CC', () => {
  const report = {
    files: [
      {
        path: 'app/models/user.rb',
        offenses: [
          { cop_name: 'Metrics/MethodLength', message: 'Method too long.', location: { line: 5 } },
          { cop_name: 'Metrics/CyclomaticComplexity', message: 'Cyclomatic complexity for process is too high. [12/10]', location: { line: 20 } },
        ],
      },
      {
        path: 'app/models/order.rb',
        offenses: [
          { cop_name: 'Metrics/CyclomaticComplexity', message: 'Cyclomatic complexity for calc is too high. [15/10]', location: { line: 8 } },
        ],
      },
    ],
    summary: { offense_count: 3, inspected_file_count: 2 },
  };
  const out = parseRubocop(report);
  assert.strictEqual(out.tool, 'rubocop');
  assert.strictEqual(out.violations, 2);
  assert.deepStrictEqual(out.items[0], { scope: 'line 20', file: 'app/models/user.rb', line: 20, cc: 12 });
  assert.strictEqual(out.items[1].cc, 15);
});

test('parseRubocop degrades to zero on empty/garbage', () => {
  assert.strictEqual(parseRubocop(null).violations, 0);
  assert.strictEqual(parseRubocop({ files: null }).violations, 0);
});

test('parseDuplication reads statistics.total and rounds percentage', () => {
  const report = {
    statistics: { total: { percentage: 4.3667, duplicatedLines: 218, lines: 5000, clones: 9 } },
  };
  const r = parseDuplication(report);
  assert.strictEqual(r.percentage, 4.4);
  assert.strictEqual(r.duplicated_lines, 218);
  assert.strictEqual(r.total_lines, 5000);
  assert.strictEqual(r.clones, 9);
  assert.deepStrictEqual(r.clone_items, []);
});

test('parseDuplication degrades to a clean zero on empty/garbage', () => {
  const r1 = parseDuplication(null);
  assert.strictEqual(r1.percentage, 0);
  assert.strictEqual(r1.duplicated_lines, 0);
  assert.strictEqual(r1.total_lines, 0);
  assert.strictEqual(r1.clones, 0);
  assert.deepStrictEqual(r1.clone_items, []);
  const r2 = parseDuplication({});
  assert.strictEqual(r2.percentage, 0);
  assert.deepStrictEqual(r2.clone_items, []);
});

// extractLinterJson — a linter run through `mix` (Credo) prepends compile chatter
// ("==> file_system", "Compiling N files (.ex)") to stdout before the JSON. The
// captured output must be sliced to the JSON payload before JSON.parse.

test('extractLinterJson strips leading mix compile chatter before the JSON object', () => {
  const stdout = [
    '==> file_system',
    'Compiling 2 files (.ex)',
    '==> credo',
    '{"issues":[{"check":"X","message":"m"}]}',
  ].join('\n');
  const parsed = JSON.parse(extractLinterJson(stdout));
  assert.strictEqual(parsed.issues.length, 1);
});

test('extractLinterJson strips both leading and trailing noise around the object', () => {
  const stdout = '==> credo\n{"issues":[]}\nGenerated credo app\n';
  assert.strictEqual(extractLinterJson(stdout), '{"issues":[]}');
});

test('extractLinterJson handles a top-level array payload', () => {
  const stdout = 'noise\n[{"a":1},{"b":2}]\n';
  assert.strictEqual(extractLinterJson(stdout), '[{"a":1},{"b":2}]');
});

test('extractLinterJson returns clean JSON unchanged', () => {
  const clean = '{"issues":[]}';
  assert.strictEqual(extractLinterJson(clean), clean);
});

test('extractLinterJson throws when there is no JSON payload (no false green)', () => {
  assert.throws(() => extractLinterJson('==> credo\nCompiling...\n'), /no JSON/);
  assert.throws(() => extractLinterJson(''), /no JSON/);
});

test('parseLizard counts functions over CCN 10 and extracts file + name + cc', () => {
  // real lizard --csv shape: no header; 0=NLOC 1=CCN ... 6=file 7=name 8=longname
  const text = [
    '2,1,15,1,2,"simple@1-2@src/a.ts","src/a.ts","simple","simple ( a )",1,2',
    '40,13,300,2,40,"big@10-50@src/a.ts","src/a.ts","big","big ( a , b )",10,50',
    '5,10,80,1,5,"edge@1-5@src/b.ts","src/b.ts","edge","edge ( x )",1,5',
    '60,22,500,3,60,"huge@1-60@src/c.tsx","src/c.tsx","huge","huge ( a , b , c )",1,60',
  ].join('\n');
  const out = parseLizard({ format: 'csv', text });
  assert.strictEqual(out.tool, 'lizard');
  assert.strictEqual(out.violations, 2); // 13 and 22 (10 is NOT a violation)
  assert.deepStrictEqual(out.items[0], { scope: 'big', file: 'src/a.ts', line: 10, cc: 13 });
  assert.strictEqual(out.items[1].cc, 22);
  assert.strictEqual(out.items[1].file, 'src/c.tsx');
});

test('parseLizard handles quoted fields containing commas without misaligning columns', () => {
  const text = '40,11,300,3,40,"f@1-40@src/x,y.ts","src/x,y.ts","f","f ( a , b , c )",1,40';
  const out = parseLizard({ format: 'csv', text });
  assert.strictEqual(out.violations, 1);
  assert.strictEqual(out.items[0].file, 'src/x,y.ts'); // comma inside quotes preserved
  assert.strictEqual(out.items[0].cc, 11);
});

test('parseLizard respects a custom threshold', () => {
  const text = '5,10,80,1,5,"e@1-5@src/b.ts","src/b.ts","e","e ( x )",1,5';
  assert.strictEqual(parseLizard({ format: 'csv', text }, { threshold: 9 }).violations, 1);
  assert.strictEqual(parseLizard({ format: 'csv', text }, { threshold: 10 }).violations, 0);
});

test('parseLizard degrades to zero on empty/garbage', () => {
  assert.strictEqual(parseLizard(null).violations, 0);
  assert.strictEqual(parseLizard({}).violations, 0);
  assert.strictEqual(parseLizard({ format: 'csv', text: '' }).violations, 0);
  assert.strictEqual(parseLizard({ format: 'csv', text: 'garbage,line\nno numbers' }).violations, 0);
});

test('complexityParser maps tools and throws on unknown', () => {
  assert.strictEqual(complexityParser('credo'), parseCredo);
  assert.strictEqual(complexityParser('rubocop'), parseRubocop);
  assert.strictEqual(complexityParser('lizard'), parseLizard);
  assert.throws(() => complexityParser('eslint'), /no parser for complexity tool 'eslint'/);
  assert.throws(() => complexityParser(undefined), /no parser for complexity tool/);
  assert.throws(() => complexityParser('constructor'), /no parser for complexity tool/);
  assert.throws(() => complexityParser('toString'), /no parser for complexity tool/);
});
