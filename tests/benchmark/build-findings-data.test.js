const { test } = require('node:test');
const assert = require('node:assert');
const { buildFindingsForSystem } = require('../../scripts/benchmark/build-findings-data');

function reader(map) { return async (name, kind) => (map[kind] ?? null); }

test('C9 secrets/deps/sast groups are built with locations; NO secret values', async () => {
  const map = {
    gitleaks: [ { Description: 'AWS key', File: 'lib/a.ex', RuleID: 'aws-access-token', Match: 'AKIA_SECRET_VALUE', Secret: 'AKIA_SECRET_VALUE' } ],
    trivy: { Results: [ { Target: 'mix.lock', Vulnerabilities: [ { Severity: 'CRITICAL', PkgName: 'plug', VulnerabilityID: 'CVE-1' } ] } ] },
    semgrep: { results: [ { check_id: 'a.b.xss', path: 'lib/x.ex', start: { line: 5 }, extra: { severity: 'ERROR' } } ] },
    'direct-deps': { prod: ['plug'], dev: [] },
  };
  const env = await buildFindingsForSystem({ sys: { name: 'sys', stack: 'elixir', sast_tool: 'semgrep' }, readReport: reader(map), sastTool: 'semgrep', triageConfig: {}, generatedAt: '2026-07-17' });
  const c9 = env.criteria['9'];
  assert.ok(c9, 'C9 present');
  const secrets = c9.groups.find((g) => g.sub === 'secrets');
  assert.strictEqual(secrets.items[0].file, 'lib/a.ex');
  assert.strictEqual(secrets.items[0].rule, 'aws-access-token');
  // SECURITY: no secret value anywhere in the envelope
  const blob = JSON.stringify(env);
  assert.ok(!blob.includes('AKIA_SECRET_VALUE'), 'no matched secret value emitted');
  assert.ok(c9.groups.find((g) => g.sub === 'deps').items[0].id === 'CVE-1');
  assert.ok(c9.groups.find((g) => g.sub === 'sast').items[0].path === 'lib/x.ex');
});

test('ephemeral clone-root paths are normalized to repo-relative (no /tmp/scan-*/repo leak)', async () => {
  // Third-party tools (gitleaks/trivy/semgrep/credo/jscpd) report ABSOLUTE paths
  // rooted at the per-run clone dir (/tmp/scan-<sys>-<rand>/repo, /tmp/scan-c8-<sys>-<rand>/repo).
  // The random suffix would (a) render garbage in the UI and (b) make findings-*.json
  // change on every scan even with no real change, defeating the data-PR gate.
  const map = {
    gitleaks: [ { Description: 'k', File: '/tmp/scan-sys-AbC123/repo/lib/a.ex', RuleID: 'private-key' } ],
    trivy: { Results: [ { Target: '/tmp/scan-sys-AbC123/repo/mix.lock', Vulnerabilities: [ { Severity: 'CRITICAL', PkgName: 'plug', VulnerabilityID: 'CVE-1' } ] } ] },
    semgrep: { results: [ { check_id: 'a.b.xss', path: '/tmp/scan-sys-AbC123/repo/lib/x.ex', start: { line: 5 }, extra: { severity: 'ERROR' } } ] },
    'direct-deps': { prod: ['plug'], dev: [] },
    credo: { issues: [ { check: 'Credo.Check.Refactor.CyclomaticComplexity', message: 'Function is too complex (cyclomatic complexity is 12, max is 10).', filename: '/tmp/scan-c8-sys-Zx9/repo/lib/big.ex', scope: 'App.Big' } ] },
    jscpd: { duplicates: [ { firstFile: { name: '/tmp/scan-c8-sys-Zx9/repo/lib/dupe_a.ex' }, secondFile: { name: '/tmp/scan-c8-sys-Zx9/repo/lib/dupe_b.ex' } } ] },
    'simplicity-meta': { tool: 'credo' },
  };
  const env = await buildFindingsForSystem({ sys: { name: 'sys', stack: 'elixir', sast_tool: 'semgrep' }, readReport: reader(map), sastTool: 'semgrep', triageConfig: {}, generatedAt: '2026-07-17' });
  const blob = JSON.stringify(env);
  assert.ok(!blob.includes('/tmp/scan-'), 'no ephemeral clone-root path anywhere in the envelope');
  assert.ok(!blob.includes('/repo/'), 'no clone-root /repo/ boundary leaks through');
  const c9 = env.criteria['9'];
  assert.strictEqual(c9.groups.find((g) => g.sub === 'secrets').items[0].file, 'lib/a.ex');
  assert.strictEqual(c9.groups.find((g) => g.sub === 'sast').items[0].path, 'lib/x.ex');
  assert.strictEqual(c9.groups.find((g) => g.sub === 'deps').items[0].target, 'mix.lock');
  const c8 = env.criteria['8'];
  assert.strictEqual(c8.groups.find((g) => g.sub === 'complexity').items[0].file, 'lib/big.ex');
  const dup = c8.groups.find((g) => g.sub === 'duplication').items[0];
  assert.strictEqual(dup.fileA, 'lib/dupe_a.ex');
  assert.strictEqual(dup.fileB, 'lib/dupe_b.ex');
});

test('C6 untested samples + discipline map to groups; empty criteria omitted', async () => {
  const map = {
    'test-coverage': { applicable: true, stacks: { elixir: { source_files: 10, tested_files: 9, untested_samples: ['lib/a.ex'], tooling: { tool: 'cobertura-action', present: true, thresholds: [80], enforced: true } }, frontend: { source_files: 6, tested_files: 0, untested_samples: ['assets/x.ts'], tooling: { tool: null, present: false, thresholds: [], enforced: false } } } },
  };
  const env = await buildFindingsForSystem({ sys: { name: 'sys', stack: 'elixir' }, readReport: reader(map), sastTool: 'semgrep', triageConfig: {}, generatedAt: '2026-07-17' });
  const c6 = env.criteria['6'];
  assert.ok(c6.groups.find((g) => g.sub === 'breadth').items.some((i) => i.file === 'assets/x.ts'));
  assert.ok(c6.groups.find((g) => g.sub === 'discipline').items.some((i) => i.stack === 'frontend'));
  assert.strictEqual(env.criteria['9'], undefined); // no C9 reports -> omitted
});

test('C2 with rest block: produces rest-descriptions group with undescribed kinds only', async () => {
  const map = {
    'documented-apis': {
      applicable: true,
      by_type: [{ type: 'Query', total: 5, described: 5 }], // all described — no graphql group
      rest: {
        by_kind: {
          operation: { total: 10, described: 6 },   // undescribed: 4
          parameter: { total: 20, described: 20 },  // undescribed: 0 — omitted
          property:  { total: 8,  described: 3 },   // undescribed: 5
        },
      },
    },
  };
  const env = await buildFindingsForSystem({ sys: { name: 'sys', stack: 'elixir' }, readReport: reader(map), sastTool: 'semgrep', triageConfig: {}, generatedAt: '2026-07-22' });
  const c2 = env.criteria['2'];
  assert.ok(c2, 'C2 criterion present');
  const restGroup = c2.groups.find((g) => g.sub === 'rest-descriptions');
  assert.ok(restGroup, 'rest-descriptions group present');
  assert.strictEqual(restGroup.label, 'Undescribed REST elements');
  const byKind = Object.fromEntries(restGroup.items.map((i) => [i.kind, i.undescribed]));
  assert.strictEqual(byKind['operation'], 4);
  assert.strictEqual(byKind['property'], 5);
  assert.strictEqual(byKind['parameter'], undefined, 'fully-described kind must be omitted');
});

test('C2 without rest block: only graphql descriptions group, no rest-descriptions', async () => {
  const map = {
    'documented-apis': {
      applicable: true,
      by_type: [{ type: 'Query', total: 5, described: 3 }], // undescribed: 2
    },
  };
  const env = await buildFindingsForSystem({ sys: { name: 'sys', stack: 'elixir' }, readReport: reader(map), sastTool: 'semgrep', triageConfig: {}, generatedAt: '2026-07-22' });
  const c2 = env.criteria['2'];
  assert.ok(c2, 'C2 criterion present');
  assert.ok(c2.groups.find((g) => g.sub === 'descriptions'), 'graphql descriptions group present');
  assert.strictEqual(c2.groups.find((g) => g.sub === 'rest-descriptions'), undefined, 'no rest-descriptions group when no rest block');
});

test('c8 findings for a lizard system list complexity violations from parseLizard', async () => {
  const csv = '40,13,300,2,40,"big@10-50@src/a.ts","src/a.ts","big","big ( a , b )",10,50';
  const map = {
    'simplicity-meta': { stack: 'ts', tool: 'lizard', loc: 2000 },
    lizard: { format: 'csv', text: csv },
    jscpd: { statistics: { total: { percentage: 0, duplicatedLines: 0, lines: 2000, clones: 0 } }, duplicates: [] },
  };
  const env = await buildFindingsForSystem({
    sys: { name: 'webapp', stack: 'ts' },
    readReport: reader(map),
    sastTool: 'semgrep',
    triageConfig: {},
    generatedAt: '2026-07-24',
  });
  const c8 = env.criteria['8'];
  assert.ok(c8, 'C8 present');
  const complexity = c8.groups.find((g) => g.sub === 'complexity');
  assert.ok(complexity, 'complexity group present');
  assert.strictEqual(complexity.items.length, 1);
  assert.strictEqual(complexity.items[0].file, 'src/a.ts');
});

test('C4 observability: rung from array LENGTH (not truthiness); N/A frontend skipped; evidence from arrays', async () => {
  const map = {
    observability: {
      logging: { declared: ['logger_json'], configured: [], exercised: [] },       // -> declared
      tracing: { declared: [], configured: [], exercised: [] },                     // -> none, empty evidence
      backend_errors: { declared: ['sentry'], configured: ['config/prod.exs'], exercised: ['lib/app.ex'] }, // -> exercised
      frontend_errors: { applicable: false, declared: [], configured: [], exercised: [] }, // skipped
    },
  };
  const env = await buildFindingsForSystem({ sys: { name: 'sys', stack: 'elixir' }, readReport: reader(map), sastTool: 'semgrep', triageConfig: {}, generatedAt: '2026-07-17' });
  const pillars = env.criteria['4'].groups.find((g) => g.sub === 'pillars').items;
  const by = Object.fromEntries(pillars.map((p) => [p.pillar, p]));
  assert.strictEqual(by['Structured logging'].rung, 'declared');
  assert.strictEqual(by['Distributed tracing'].rung, 'none');            // empty arrays -> none, NOT exercised
  assert.deepStrictEqual(by['Distributed tracing'].evidence, []);
  assert.strictEqual(by['Backend error tracking'].rung, 'exercised');
  assert.deepStrictEqual(by['Backend error tracking'].evidence, ['lib/app.ex']);
  assert.strictEqual(by['Frontend error tracking'], undefined);          // applicable:false skipped
});

// Finding 3: endsWith can match multiple keys; the longest match must win.
test('c8Groups Vue offset: a finding that matches two offset keys uses the longer (more specific) one', async () => {
  // Both keys share the suffix 'src/Login.vue.ts'; the longer key is more specific.
  const offsets = {
    'src/Login.vue.ts': { source: 'src/Login.vue', lineOffset: 1 },
    'components/src/Login.vue.ts': { source: 'components/src/Login.vue', lineOffset: 10 },
  };
  const map = {
    'simplicity-meta': { languages: [{ language: 'typescript', tool: 'lizard', report: 'complexity-ts' }], loc: 5000 },
    'complexity-ts': { format: 'csv', text: '40,15,300,2,40,"f@1-40@extracted/components/src/Login.vue.ts","extracted/components/src/Login.vue.ts","f","f()",1,40' },
    jscpd: { statistics: { total: { percentage: 0, duplicatedLines: 0, lines: 1000 } }, duplicates: [] },
    'vue-offsets': offsets,
  };
  const env = await buildFindingsForSystem({
    sys: { name: 'sys', stack: 'ts', sast_tool: 'semgrep' },
    readReport: reader(map),
    triageConfig: {},
    generatedAt: '2026-07-30',
  });
  const complexity = env.criteria['8'].groups.find((g) => g.sub === 'complexity');
  assert.strictEqual(complexity.items[0].file, 'components/src/Login.vue', 'longer key must win');
});

// Finding 4: c8Groups must accumulate items from all measured languages and remap
// Vue extraction paths back to the source .vue file + original line.
test('c8Groups accumulates items from multiple languages and remaps Vue file and line', async () => {
  const offsets = {
    'extracted/Component.vue.ts': { source: 'src/Component.vue', lineOffset: 5 },
  };
  const map = {
    'simplicity-meta': {
      languages: [
        { language: 'elixir', tool: 'credo', report: 'complexity-elixir' },
        { language: 'typescript', tool: 'lizard', report: 'complexity-ts' },
      ],
      loc: 10000,
    },
    'complexity-elixir': { issues: [{
      check: 'Credo.Check.Refactor.CyclomaticComplexity',
      message: 'Function is too complex (cyclomatic complexity is 12, max is 10).',
      filename: 'lib/big.ex', line_no: 5, scope: 'Big.func',
    }] },
    // col 9 = 10 (start-line); after Vue offset: (10 - 1) + 5 = 14
    'complexity-ts': { format: 'csv', text: '40,15,300,2,40,"f@1-40@extracted/Component.vue.ts","extracted/Component.vue.ts","f","f()",10,50' },
    jscpd: { statistics: { total: { percentage: 0, duplicatedLines: 0, lines: 1000 } }, duplicates: [] },
    'vue-offsets': offsets,
  };
  const env = await buildFindingsForSystem({
    sys: { name: 'sys', stack: 'elixir', sast_tool: 'semgrep' },
    readReport: reader(map),
    triageConfig: {},
    generatedAt: '2026-07-30',
  });
  const c8 = env.criteria['8'];
  assert.ok(c8, 'C8 criterion present');
  const complexity = c8.groups.find((g) => g.sub === 'complexity');
  assert.ok(complexity, 'complexity group present');
  assert.strictEqual(complexity.items.length, 2, 'items from both languages must be accumulated');
  const elixirItem = complexity.items.find((i) => i.language === 'elixir');
  const tsItem = complexity.items.find((i) => i.language === 'typescript');
  assert.ok(elixirItem, 'elixir item must be present with language tag');
  assert.ok(tsItem, 'typescript item must be present with language tag');
  // Vue offset: file and line both remapped
  assert.strictEqual(tsItem.file, 'src/Component.vue', 'extraction path must be remapped to .vue source');
  assert.strictEqual(tsItem.line, 14, 'line must be (start-1) + lineOffset = (10-1)+5 = 14');
});
