const { test } = require('node:test');
const assert = require('node:assert');
const { buildBenchmarkData } = require('../../scripts/benchmark/build-benchmark-data');

function fakeReader(byName) {
  return async (name, kind) => (byName[name] ? byName[name][kind] || null : null);
}

// A readReport fake that returns a C2 documented-apis report for specific systems,
// N/A for others, and null for every other report kind.
function fakeReaderMap(map) {
  return async (name, kind) => (map[`${name}/${kind}`] ?? null);
}

test('buildBenchmarkData scores each system C9 from its three reports', async () => {
  const reports = {
    alpha: {
      gitleaks: [],
      trivy: { Results: [{ Vulnerabilities: [{ Severity: 'HIGH' }] }] },
      semgrep: { results: [] },
    },
    echo: {
      gitleaks: [{ Description: 'k', File: '.env', RuleID: 'generic' }],
      trivy: { Results: [] },
      semgrep: { results: [] },
    },
  };
  const out = await buildBenchmarkData({
    systems: [{ name: 'alpha', sast_tool: 'semgrep' }, { name: 'echo', sast_tool: 'semgrep' }],
    readReport: fakeReader(reports),
    sastTool: 'semgrep',
    assessedAt: '2026-06-30',
    lastUpdated: '2026-06-30',
  });

  // alpha: the lone High CVE has no PkgName -> transitive -> not scored;
  // secrets 5.0, deps 5.0, sast 5.0 -> 5.0, not capped
  assert.strictEqual(out.systems.alpha.criteria['9'].score, 5.0);
  assert.strictEqual(out.systems.alpha.hard_capped, false);
  assert.strictEqual(out.systems.alpha.colour, 'green');
  assert.strictEqual(out.systems.alpha.criteria['9'].audit.deps.transitive.high, 1);

  // echo: secret present -> hard-cap red
  assert.strictEqual(out.systems.echo.hard_capped, true);
  assert.strictEqual(out.systems.echo.colour, 'red');
  assert.strictEqual(out.example, false);
});

test('buildBenchmarkData threads triage config + dev-deps through to scoring', async () => {
  const LEAF = 'github-actions-mutable-action-tag';
  const MUT = `yaml.github-actions.security.${LEAF}.${LEAF}`; // --config auto doubled id
  const reports = {
    alpha: {
      gitleaks: [
        { Description: 'fixture', File: 'apps/web/test/fixtures/x.json', RuleID: 'generic' },
        { Description: 'fixture2', File: 'spec/cassette_library/y.yml', RuleID: 'generic' },
      ],
      trivy: { Results: [{ Vulnerabilities: [
        { Severity: 'CRITICAL', PkgName: '@vitest/browser' }, // dev-only → discounted
      ] }] },
      semgrep: { results: [
        { check_id: MUT, path: '.github/workflows/ci.yml', extra: { severity: 'ERROR' } }, // remapped to info
        { check_id: MUT, path: '.github/workflows/ci.yml', extra: { severity: 'ERROR' } },
      ] },
      'direct-deps': { prod: ['plug'], dev: ['@vitest/browser'] },
    },
  };
  const triageConfig = {
    exclude_paths: ['**/test/**', '**/fixtures/**', '**/cassette_library/**'],
    semgrep_severity_remap: { [LEAF]: 'INFO' },
  };
  const out = await buildBenchmarkData({
    systems: [{ name: 'alpha', sast_tool: 'semgrep' }],
    readReport: fakeReader(reports),
    sastTool: 'semgrep',
    triageConfig,
    assessedAt: '2026-07-06',
    lastUpdated: '2026-07-06',
  });

  const c9 = out.systems.alpha.criteria['9'];
  // secrets all excluded (5.0) + mutable-tag remapped to info (sast 5.0); the
  // dev-only Critical is discounted to medium (deps 3.5 amber), not hidden ->
  // composite mean(5.0, 3.5, 5.0) = 4.5, green, un-capped.
  assert.strictEqual(c9.score, 4.5);
  assert.strictEqual(c9.colour, 'green');
  assert.strictEqual(out.systems.alpha.hard_capped, false);
  assert.strictEqual(c9.audit.secrets.excluded_by_path, 2);
  assert.strictEqual(c9.audit.deps.dev.critical, 1);
  assert.strictEqual(c9.audit.sast.remapped, 2);
});

test('buildBenchmarkData scores a system with all reports missing against zeros (green)', async () => {
  const out = await buildBenchmarkData({
    systems: [{ name: 'delta', sast_tool: 'semgrep' }],
    readReport: fakeReader({}),
    sastTool: 'semgrep',
    assessedAt: '2026-06-30',
    lastUpdated: '2026-06-30',
  });
  assert.strictEqual(out.systems.delta.criteria['9'].score, 5.0);
  assert.strictEqual(out.systems.delta.colour, 'green');
});

test('buildBenchmarkData adds C8 when simplicity reports are present (Elixir/Credo)', async () => {
  const reports = {
    alpha: {
      gitleaks: [], trivy: { Results: [] }, semgrep: { results: [] },
      'simplicity-meta': { stack: 'elixir', tool: 'credo', loc: 208819 },
      credo: { issues: [] }, // 0 CC violations -> complexity 5.0
      jscpd: { statistics: { total: { percentage: 0, duplicatedLines: 0, lines: 5000, clones: 0 } } },
    },
  };
  const out = await buildBenchmarkData({
    systems: [{ name: 'alpha', sast_tool: 'semgrep', stack: 'elixir' }],
    readReport: fakeReader(reports),
    sastTool: 'semgrep',
    assessedAt: '2026-07-08',
    lastUpdated: '2026-07-08',
  });
  const sys = out.systems.alpha;
  assert.strictEqual(sys.criteria['8'].score, 5.0);
  assert.strictEqual(sys.criteria['8'].colour, 'green');
  assert.strictEqual(sys.criteria['8'].critical, false);
  assert.strictEqual(sys.coverage, '2 of 7 assessed'); // C8 + C9
  assert.strictEqual(sys.criteria['8'].audit.complexity.tool, 'credo');
});

test('buildBenchmarkData uses Rubocop for a ruby stack and grades violations', async () => {
  const reports = {
    echo: {
      gitleaks: [], trivy: { Results: [] }, semgrep: { results: [] },
      'simplicity-meta': { stack: 'ruby', tool: 'rubocop', loc: 10000 },
      rubocop: { files: [{ path: 'a.rb', offenses: [
        { cop_name: 'Metrics/CyclomaticComplexity', message: 'too high. [12/10]', location: { line: 1 } },
        { cop_name: 'Metrics/CyclomaticComplexity', message: 'too high. [15/10]', location: { line: 2 } },
      ] }] },
      jscpd: { statistics: { total: { percentage: 7, duplicatedLines: 700, lines: 10000, clones: 5 } } },
    },
  };
  const out = await buildBenchmarkData({
    systems: [{ name: 'echo', sast_tool: 'semgrep', stack: 'ruby' }],
    readReport: fakeReader(reports),
    sastTool: 'semgrep',
    assessedAt: '2026-07-08',
    lastUpdated: '2026-07-08',
  });
  const c8 = out.systems.echo.criteria['8'];
  // complexity: 2 over 10k = 0.2/KLOC -> 4.0 green; duplication 7% -> 2.0 red; mean 3.0 amber
  assert.strictEqual(c8.audit.complexity.tool, 'rubocop');
  assert.strictEqual(c8.audit.complexity.violations, 2);
  assert.strictEqual(c8.score, 3.0);
  assert.strictEqual(c8.colour, 'amber');
});

test('buildBenchmarkData leaves C8 Pending (absent) when no simplicity scan ran', async () => {
  const reports = {
    delta: { gitleaks: [], trivy: { Results: [] }, semgrep: { results: [] } }, // no simplicity-meta
  };
  const out = await buildBenchmarkData({
    systems: [{ name: 'delta', sast_tool: 'semgrep', stack: 'elixir' }],
    readReport: fakeReader(reports),
    sastTool: 'semgrep',
    assessedAt: '2026-07-08',
    lastUpdated: '2026-07-08',
  });
  assert.strictEqual(out.systems.delta.criteria['8'], undefined);
  assert.strictEqual(out.systems.delta.coverage, '1 of 7 assessed'); // C9 only
});

test('buildBenchmarkData adds C4 when an observability report is present', async () => {
  const reports = {
    alpha: {
      gitleaks: [], trivy: { Results: [] }, semgrep: { results: [] },
      observability: {
        logging: { declared: ['logger_json'], configured: ['config/prod.exs'], exercised: ['lib/a.ex'] },
        tracing: { declared: ['spandex'], configured: [], exercised: [] },
        backend_errors: { declared: ['sentry'], configured: ['config/prod.exs'], exercised: ['lib/ep.ex'] },
        frontend_errors: { applicable: true, declared: ['@sentry/vue'], configured: ['assets/js/app.js'], exercised: ['assets/js/app.js'] },
      },
    },
  };
  const out = await buildBenchmarkData({
    systems: [{ name: 'alpha', sast_tool: 'semgrep', stack: 'elixir' }],
    readReport: fakeReader(reports),
    sastTool: 'semgrep',
    assessedAt: '2026-07-10',
    lastUpdated: '2026-07-10',
  });
  const c4 = out.systems.alpha.criteria['4'];
  // logging 5.0, tracing 2.0, backend_errors 5.0, frontend_errors 5.0 -> mean 4.25 -> 4.3
  assert.strictEqual(c4.score, 4.3);
  assert.strictEqual(c4.critical, false);
  assert.strictEqual(out.systems.alpha.coverage, '2 of 7 assessed'); // C4 + C9
});

test('buildBenchmarkData leaves C4 Pending (absent) when no observability report', async () => {
  const out = await buildBenchmarkData({
    systems: [{ name: 'delta', sast_tool: 'semgrep', stack: 'elixir' }],
    readReport: fakeReader({ delta: { gitleaks: [], trivy: { Results: [] }, semgrep: { results: [] } } }),
    sastTool: 'semgrep',
    assessedAt: '2026-07-10',
    lastUpdated: '2026-07-10',
  });
  assert.strictEqual(out.systems.delta.criteria['4'], undefined);
});

test('buildBenchmarkData adds C7 when a deployment report is present', async () => {
  const reports = {
    alpha: {
      gitleaks: [], trivy: { Results: [] }, semgrep: { results: [] },
      deployment: {
        progressive_delivery: { mature: ['deploy.yaml'], basic: [] }, // 5.0
        automated_rollback: { mature: [], basic: [] },                 // 0.0
        pipeline_safety: { mature: ['ci.yaml'], basic: [] },           // 5.0
        independent_deployability: { deployables: 6, deploy_paths: 1, independent: false }, // 2.0
      },
    },
  };
  const out = await buildBenchmarkData({
    systems: [{ name: 'alpha', sast_tool: 'semgrep', stack: 'elixir' }],
    readReport: fakeReader(reports),
    sastTool: 'semgrep',
    assessedAt: '2026-07-15',
    lastUpdated: '2026-07-15',
  });
  const c7 = out.systems.alpha.criteria['7'];
  // mean(5.0, 0.0, 5.0, 2.0) = 3.0
  assert.strictEqual(c7.score, 3.0);
  assert.strictEqual(c7.critical, false);
  assert.strictEqual(out.systems.alpha.coverage, '2 of 7 assessed'); // C7 + C9
});

test('buildBenchmarkData leaves C7 Pending (absent) when no deployment report', async () => {
  const out = await buildBenchmarkData({
    systems: [{ name: 'delta', sast_tool: 'semgrep', stack: 'elixir' }],
    readReport: fakeReader({ delta: { gitleaks: [], trivy: { Results: [] }, semgrep: { results: [] } } }),
    sastTool: 'semgrep',
    assessedAt: '2026-07-15',
    lastUpdated: '2026-07-15',
  });
  assert.strictEqual(out.systems.delta.criteria['7'], undefined);
});

test('C2 is scored when a documented-apis report is present', async () => {
  const readReport = fakeReaderMap({
    'apollo/documented-apis': { applicable: true, files_parsed: 2, total: 10, described: 5, by_type: [] },
  });
  const data = await buildBenchmarkData({
    systems: [{ name: 'apollo', stack: 'elixir', sast_tool: 'semgrep' }],
    readReport, assessedAt: '2026-07-16', lastUpdated: '2026-07-16',
  });
  assert.strictEqual(data.systems.apollo.criteria['2'].score, 2.5); // 5*0.5
});

test('C2 is absent (Pending) for an N/A documented-apis report', async () => {
  const readReport = fakeReaderMap({
    'ruby1/documented-apis': { applicable: false },
  });
  const data = await buildBenchmarkData({
    systems: [{ name: 'ruby1', stack: 'ruby', sast_tool: 'semgrep' }],
    readReport, assessedAt: '2026-07-16', lastUpdated: '2026-07-16',
  });
  assert.strictEqual(data.systems.ruby1.criteria['2'], undefined);
});

test('buildBenchmarkData scores a JS/TS (lizard) system honestly, not a false green', async () => {
  const csv = [
    '40,13,300,2,40,"big@10-50@src/a.ts","src/a.ts","big","big ( a , b )",10,50',
    '60,22,500,3,60,"huge@1-60@src/b.tsx","src/b.tsx","huge","huge ( a )",1,60',
  ].join('\n');
  const reports = {
    webapp: {
      'simplicity-meta': { stack: 'ts', tool: 'lizard', loc: 2000 },
      lizard: { format: 'csv', text: csv },
      jscpd: { statistics: { total: { percentage: 0, duplicatedLines: 0, lines: 2000, clones: 0 } } },
    },
  };
  const out = await buildBenchmarkData({
    systems: [{ name: 'webapp', stack: 'ts', sast_tool: 'semgrep' }],
    readReport: fakeReader(reports),
    sastTool: 'semgrep',
    assessedAt: '2026-07-24',
    lastUpdated: '2026-07-24',
  });
  const c8 = out.systems.webapp.criteria['8'];
  assert.ok(c8, 'C8 should be scored');
  assert.strictEqual(c8.audit.complexity.tool, 'lizard');
  assert.strictEqual(c8.audit.complexity.violations, 2); // proves lizard output was parsed, not routed to parseCredo (which would give 0 -> green)
});

test('C6 is scored when a test-coverage report is present', async () => {
  const readReport = fakeReaderMap({
    'alpha/test-coverage': {
      applicable: true,
      stacks: {
        elixir: { source_files: 10, tested_files: 8, untested_samples: [], tooling: { tool: 'excoveralls', present: true, thresholds: [90], enforced: true } },
      },
    },
  });
  const data = await buildBenchmarkData({
    systems: [{ name: 'alpha', stack: 'elixir', sast_tool: 'semgrep' }],
    readReport, assessedAt: '2026-07-17', lastUpdated: '2026-07-17',
  });
  const c6 = data.systems.alpha.criteria['6'];
  assert.ok(c6, 'C6 entry present');
  assert.strictEqual(c6.score, 4.5); // breadth 4.0 + discipline 5.0 => 4.5
});

// C1's graph-derived metrics must be withheld on a stack whose code graph is
// known to under-resolve. The system's stack -- not the report -- decides this,
// so the composition layer has to pass it through. Without the wiring an Elixir
// system publishes a green 5.0 off a graph that missed half its dependencies.
test('C8 sums violations across every measured language', async () => {
  const reports = {
    'simplicity-meta': {
      stack: 'elixir',
      tool: 'credo',
      languages: [
        { language: 'elixir', tool: 'credo', loc: 100000, report: 'complexity-elixir', gate: { rung: 'enforced', threshold: 9 } },
        { language: 'typescript', tool: 'lizard', loc: 50000, report: 'complexity-typescript', gate: { rung: 'none', threshold: null } },
      ],
      unmeasured: [], skipped_immaterial: [], loc: 150000,
    },
    'complexity-elixir': { issues: [] },
    'complexity-typescript': { format: 'csv', text: '1,25,40,0,1,"f@1-40@/x/a.ts","/x/a.ts","f","f",1,40' },
    jscpd: { statistics: { total: { percentage: 0, duplicatedLines: 0, lines: 1000 } } },
  };
  const readReport = async (_sys, kind) => reports[kind] || null;
  const out = await buildBenchmarkData({
    systems: [{ name: 's', stack: 'elixir', sast_tool: 'semgrep' }],
    readReport, assessedAt: '2026-07-30', lastUpdated: '2026-07-30', triageConfig: {},
  });
  const c8 = out.systems.s.criteria[8];
  assert.strictEqual(c8.sub.complexity.density.score < 5.0, true, 'the TS violation must reach the density');
  // LOC-weighted, not a flat mean: the enforced Elixir gate stands in front of
  // 100k of the 150k measured lines, so it carries two-thirds of the weight.
  // (5.0*100000 + 0*50000) / 150000 = 3.3, where a flat mean would read 2.5.
  assert.strictEqual(c8.sub.complexity.gate.score, 3.3, 'gate = loc-weighted(5.0 over 100k, 0 over 50k)');
  assert.strictEqual(c8.sub.complexity.gate.weighted_by, 'loc');
  // Findings and audit must attribute violations to the tool that found them.
  assert.match(c8.findings[0], /1 by lizard \(typescript\)/);
  assert.deepStrictEqual(c8.audit.complexity.tools, ['credo', 'lizard']);
  assert.deepStrictEqual(
    c8.audit.complexity.by_language,
    [
      { language: 'elixir', tool: 'credo', loc: 100000, violations: 0 },
      { language: 'typescript', tool: 'lizard', loc: 50000, violations: 1 },
    ],
  );
  assert.match(c8.source, /^credo \+ lizard \(cyclomatic complexity, max 10\)/);
});

// A report the meta names but that is absent must fail the leg, not parse to zero
// violations while its LOC stays in the denominator. Losing alpha's
// complexity-elixir.json (197k of 298k lines) would otherwise still have scored a
// plausible-looking 4.0 (spec §5).
test('C8 throws when a report named in meta.languages is missing', async () => {
  const reports = {
    'simplicity-meta': {
      stack: 'elixir',
      tool: 'credo',
      languages: [
        { language: 'elixir', tool: 'credo', loc: 197318, report: 'complexity-elixir', gate: { rung: 'enforced', threshold: 9 } },
        { language: 'typescript', tool: 'lizard', loc: 36996, report: 'complexity-typescript', gate: { rung: 'none', threshold: null } },
      ],
      unmeasured: [], skipped_immaterial: [], loc: 234314,
    },
    // complexity-elixir deliberately absent
    'complexity-typescript': { format: 'csv', text: '1,25,40,0,1,"f@1-40@/x/a.ts","/x/a.ts","f","f",1,40' },
    jscpd: { statistics: { total: { percentage: 0, duplicatedLines: 0, lines: 1000 } } },
  };
  const readReport = async (_sys, kind) => reports[kind] || null;
  await assert.rejects(
    () => buildBenchmarkData({
      systems: [{ name: 's', stack: 'elixir', sast_tool: 'semgrep' }],
      readReport, assessedAt: '2026-07-30', lastUpdated: '2026-07-30', triageConfig: {},
    }),
    /complexity-elixir.*missing/,
  );
});

test('C1 withholds a grade for an elixir system but scores the same report for TypeScript', async () => {
  const boundaries = {
    applicable: true,
    indeterminate: null,
    module_discovery: { kind: 'pnpm-workspace', modules: ['a', 'b'], reason: null },
    cycles: { count: 0, cycles: [], bounded: false, dropped: 0 },
    fan_out: { per_module: { a: 1, b: 1 }, mean: 1 },
    external_targets: {},
    graph: { nodes: 10, edges: 4 },
  };
  const out = await buildBenchmarkData({
    systems: [
      { name: 'alpha', sast_tool: 'semgrep', stack: 'elixir' },
      { name: 'foxtrot', sast_tool: 'semgrep', stack: 'ts' },
    ],
    readReport: fakeReaderMap({ 'alpha/boundaries': boundaries, 'foxtrot/boundaries': boundaries }),
    sastTool: 'semgrep',
    assessedAt: '2026-07-29',
    lastUpdated: '2026-07-29',
  });

  assert.strictEqual(out.systems.alpha.criteria['1'].score, null);
  assert.match(out.systems.alpha.criteria['1'].indeterminate, /code graph/i);
  assert.strictEqual(out.systems.foxtrot.criteria['1'].score, 5.0);
});
