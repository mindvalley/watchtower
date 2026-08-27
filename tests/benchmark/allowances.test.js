const { test } = require('node:test');
const assert = require('node:assert');

const {
  parseAllowances, createAllowanceSet, MATCHABLE,
} = require('../../scripts/benchmark/allowances');
const {
  parseGitleaks, parseTrivy, parseSast, complexityParser,
} = require('../../scripts/benchmark/parse-reports');
const { buildBenchmarkData } = require('../../scripts/benchmark/build-benchmark-data');
const { buildFindingsForSystem } = require('../../scripts/benchmark/build-findings-data');

const secret = (reason = 'public key') => ({
  criterion: 'security', sub: 'secrets', file: 'config/dev.exs', rule: 'generic-api-key', reason,
});

function setFor(entries, system = 'sys') {
  return createAllowanceSet(parseAllowances({ allowances: entries }), system);
}

// ---- the file format is validated, loudly ---------------------------------
//
// Every one of these is a way for an allowance to do nothing while looking
// correct. A refused allowance leaves a finding counted, which is the safe
// direction; a silently inert one is indistinguishable from a broken feature.

test('an allowance can match on a line number for secrets', () => {
  const allow = setFor([{ ...secret(), line: 12 }]).matcherFor('security', 'secrets');
  assert.ok(allow({ file: 'config/dev.exs', rule: 'generic-api-key', line: 12 }), 'same line should match');
  assert.ok(!allow({ file: 'config/dev.exs', rule: 'generic-api-key', line: 99 }), 'different line should not match');
});

test('an allowance naming a field the finding does not have is refused', () => {
  assert.throws(
    () => parseAllowances({ allowances: [{ criterion: 'security', sub: 'secrets', fle: 'x.exs', reason: 'typo' }] }),
    /not part of a security:secrets finding/,
  );
});

test('an allowance naming no fields is refused, because it would allow everything', () => {
  assert.throws(
    () => parseAllowances({ allowances: [{ criterion: 'security', sub: 'secrets', reason: 'all of them' }] }),
    /would allow every security:secrets finding/,
  );
});

test('an allowance for a criterion that cannot carry one is refused', () => {
  assert.throws(
    () => parseAllowances({ allowances: [{ criterion: 'deployment', sub: 'rollback', reason: 'external' }] }),
    /cannot carry allowances/,
  );
  // Duplication is deliberately absent: its score does not come from the list of
  // clones, so filtering that list would remove the finding and leave the number.
  assert.ok(!Object.keys(MATCHABLE).includes('simplicity:duplication'));
});

test('an allowance without a reason is refused', () => {
  const { reason, ...noReason } = secret();
  assert.throws(() => parseAllowances({ allowances: [noReason] }), /no reason/);
});

test('allowed_by must be an email address when present', () => {
  assert.throws(
    () => parseAllowances({ allowances: [{ ...secret(), allowed_by: 'person' }] }),
    /not an email address/,
  );
  assert.doesNotThrow(
    () => parseAllowances({ allowances: [{ ...secret(), allowed_by: 'person@company.com' }] }),
  );
});

test('allowed_on must be a JavaScript timestamp when present', () => {
  assert.throws(
    () => parseAllowances({ allowances: [{ ...secret(), allowed_on: '2026-08-19' }] }),
    /not a JavaScript timestamp/,
  );
  assert.doesNotThrow(
    () => parseAllowances({ allowances: [{ ...secret(), allowed_on: '2026-08-19T09:32:00.000Z' }] }),
  );
});

test('a missing or empty list is an empty list, not an error', () => {
  assert.deepStrictEqual(parseAllowances(null), []);
  assert.deepStrictEqual(parseAllowances({}), []);
  assert.deepStrictEqual(parseAllowances({ allowances: [] }), []);
});

// ---- matching --------------------------------------------------------------

test('an allowance matches a scanner path carrying the throwaway clone directory', () => {
  // THE ONE THAT WOULD HAVE SUNK IT SILENTLY. Scanners report
  // /tmp/scan-<sys>-<rand>/repo/config/dev.exs; the report only shortens paths on
  // the way out. Without normalising here, no allowance naming a file would ever
  // have matched, and the feature would have looked built and done nothing.
  const allow = setFor([secret()]).matcherFor('security', 'secrets');
  const hit = allow({ file: '/tmp/scan-sys-a1b2c3/repo/config/dev.exs', rule: 'generic-api-key' });
  assert.ok(hit, 'expected the clone-prefixed path to match');
  assert.strictEqual(hit.reason, 'public key');
});

test('an allowance on a .vue file matches the extracted .vue.ts the linter reports', () => {
  const allow = setFor([{
    criterion: 'simplicity', sub: 'complexity', file: 'src/Login.vue', reason: 'generated',
  }]).matcherFor('simplicity', 'complexity');
  assert.ok(allow({ file: '/tmp/scan-c8-sys-x/repo/src/Login.vue.ts', scope: 'submit', cc: 14 }));
});

test('leaving a field out broadens; naming it narrows', () => {
  const broad = setFor([{
    criterion: 'security', sub: 'secrets', rule: 'generic-api-key', reason: 'public ids',
  }]).matcherFor('security', 'secrets');
  assert.ok(broad({ file: 'anywhere.exs', rule: 'generic-api-key' }));

  const narrow = setFor([secret()]).matcherFor('security', 'secrets');
  assert.ok(!narrow({ file: 'other.exs', rule: 'generic-api-key' }));
});

test('an allowance scoped to one system does not fire on another', () => {
  const entries = [{ ...secret(), system: 'alpha' }];
  assert.ok(setFor(entries, 'alpha').matcherFor('security', 'secrets'));
  assert.strictEqual(setFor(entries, 'beta').matcherFor('security', 'secrets'), null);
});

test('no allowances for a sub-metric yields no matcher at all', () => {
  // The untouched path stays untouched: parsers get null and run exactly as they
  // did before this existed. This is what makes shipping the mechanism with an
  // empty list provably unable to move a score.
  assert.strictEqual(setFor([]).matcherFor('security', 'secrets'), null);
  assert.strictEqual(setFor([secret()]).matcherFor('security', 'sast'), null);
});

// ---- every parser honours it ----------------------------------------------

test('all three complexity parsers honour an allowance', () => {
  // C8 has now had FIVE defects where one arm of a per-language dispatch carried
  // something its neighbour had already had fixed. This asserts the whole
  // dispatch at once rather than whichever arm was in front of me.
  const reports = {
    credo: { issues: [{ check: 'Credo.Check.Refactor.CyclomaticComplexity', message: 'complexity is 14, max is 10', filename: 'lib/a.ex', line_no: 3, scope: 'A.run' }] },
    rubocop: { files: [{ path: 'app/a.rb', offenses: [{ cop_name: 'Metrics/CyclomaticComplexity', message: 'too high. [14/10]', location: { line: 3 } }] }] },
    lizard: { text: '5,14,60,2,20,"a.py:1","app/a.py","run","run()",3,20' },
  };
  const files = { credo: 'lib/a.ex', rubocop: 'app/a.rb', lizard: 'app/a.py' };

  for (const tool of Object.keys(reports)) {
    const parse = complexityParser(tool);
    const before = parse(reports[tool]);
    assert.strictEqual(before.violations, 1, `${tool}: fixture should produce one violation`);

    const allow = setFor([{
      criterion: 'simplicity', sub: 'complexity', file: files[tool], reason: 'vendored',
    }]).matcherFor('simplicity', 'complexity');
    const after = parse(reports[tool], { allow });

    assert.strictEqual(after.violations, 0, `${tool}: allowed violation still counted`);
    assert.strictEqual(after.allowed, 1, `${tool}: allowed violation not recorded`);
    assert.strictEqual(after.allowed_items[0].allowed_reason, 'vendored', `${tool}: reason not carried`);
  }
});

test('gitleaks: an allowed secret leaves the confirmed count, and the review bucket too', () => {
  const report = [
    { Description: 'k', File: 'config/dev.exs', RuleID: 'generic-api-key' },
    { Description: 'k', File: 'config/prod.exs', RuleID: 'aws-access-token' },
  ];
  const opts = { reviewRules: ['generic-api-key'] };
  const before = parseGitleaks(report, opts);
  assert.strictEqual(before.review_secrets, 1);
  assert.strictEqual(before.secrets, 1);

  const allow = setFor([secret()]).matcherFor('security', 'secrets');
  const after = parseGitleaks(report, { ...opts, allow });
  assert.strictEqual(after.review_secrets, 0, 'a review-bucket match should be allowable');
  assert.strictEqual(after.secrets, 1, 'the unrelated confirmed secret must survive');
  assert.strictEqual(after.allowed, 1);
});

test('trivy: an allowed CVE leaves every count it fed, including raw', () => {
  const report = {
    Results: [{
      Target: 'mix.lock',
      Vulnerabilities: [
        { Severity: 'CRITICAL', PkgName: 'storybook', VulnerabilityID: 'CVE-1' },
        { Severity: 'CRITICAL', PkgName: 'other', VulnerabilityID: 'CVE-2' },
      ],
    }],
  };
  const opts = { prodDeps: ['storybook', 'other'] };
  assert.strictEqual(parseTrivy(report, opts).prod.critical, 2);

  const allow = setFor([{
    criterion: 'security', sub: 'deps', package: 'storybook', reason: 'dev-only in practice',
  }]).matcherFor('security', 'deps');
  const after = parseTrivy(report, { ...opts, allow });
  assert.strictEqual(after.prod.critical, 1);
  assert.strictEqual(after.raw.critical, 1, 'an allowed CVE should leave the raw count too');
  assert.strictEqual(after.allowed, 1);
});

test('semgrep: an allowed finding is absent from raw and triaged, and marked in items', () => {
  const report = {
    results: [
      { check_id: 'rules.a.a', path: 'lib/a.ex', start: { line: 2 }, extra: { severity: 'ERROR' } },
      { check_id: 'rules.b.b', path: 'lib/b.ex', start: { line: 4 }, extra: { severity: 'ERROR' } },
    ],
  };
  assert.strictEqual(parseSast(report, 'semgrep').triaged.high, 2);

  const allow = setFor([{
    criterion: 'security', sub: 'sast', id: 'rules.a.a', reason: 'accepted pattern',
  }]).matcherFor('security', 'sast');
  const after = parseSast(report, 'semgrep', { allow });
  assert.strictEqual(after.triaged.high, 1);
  assert.strictEqual(after.raw.high, 1);
  assert.strictEqual(after.allowed_items[0].disposition, 'allowed');
});

test('a SAST tool with no per-finding list refuses allowances rather than ignoring them', () => {
  const allow = setFor([{
    criterion: 'security', sub: 'sast', id: 'x', reason: 'y',
  }]).matcherFor('security', 'sast');
  // brakeman/sobelow report counts only. Silently ignoring the caller's
  // allowances would leave findings counted with no sign the entries did nothing.
  assert.throws(() => parseSast({}, 'brakeman', { allow }), /reports counts only/);
  // ...and with no allowances in play it behaves exactly as before.
  assert.strictEqual(parseSast({}, 'brakeman').triaged.high, 0);
});

// ---- the tally -------------------------------------------------------------

test('the summary counts what each allowance absorbed, and keeps the zeros', () => {
  const set = setFor([
    secret('public key'),
    { criterion: 'security', sub: 'secrets', file: 'gone.exs', rule: 'aws-access-token', reason: 'since fixed' },
  ]);
  const allow = set.matcherFor('security', 'secrets');
  allow({ file: 'config/dev.exs', rule: 'generic-api-key' });
  allow({ file: 'config/dev.exs', rule: 'generic-api-key' });

  const summary = set.summary();
  assert.strictEqual(summary.length, 2, 'an entry that matched nothing must still be listed');
  assert.strictEqual(summary.find((s) => s.match.file === 'config/dev.exs').matched, 2);
  assert.strictEqual(set.unmatched().length, 1);
  assert.strictEqual(set.unmatched()[0].match.file, 'gone.exs');
});

// ---- end to end ------------------------------------------------------------

const reportsFor = (secretFile) => ({
  sys: {
    gitleaks: [{ Description: 'k', File: secretFile, RuleID: 'private-key' }],
    trivy: { Results: [] },
    semgrep: { results: [] },
  },
});
const reader = (byName) => async (name, kind) => (byName[name] ? byName[name][kind] || null : null);

test('an allowance moves the score and clears the hard cap', async () => {
  const base = {
    systems: [{ name: 'sys', sast_tool: 'semgrep' }],
    readReport: reader(reportsFor('config/dev.exs')),
    sastTool: 'semgrep',
    assessedAt: '2026-08-19',
    lastUpdated: '2026-08-19',
  };

  const before = await buildBenchmarkData(base);
  assert.strictEqual(before.systems.sys.hard_capped, true);
  assert.strictEqual(before.systems.sys.criteria['9'].sub.secrets.score, 0.0);

  const after = await buildBenchmarkData({
    ...base,
    allowances: parseAllowances({
      allowances: [{
        criterion: 'security', sub: 'secrets', file: 'config/dev.exs', rule: 'private-key',
        reason: 'sample key committed for the test suite',
      }],
    }),
  });
  assert.strictEqual(after.systems.sys.hard_capped, false, 'allowing the only secret should clear the cap');
  assert.strictEqual(after.systems.sys.criteria['9'].sub.secrets.score, 5.0);
  assert.strictEqual(after.systems.sys.criteria['9'].audit.secrets.allowed, 1);
  // Said out loud on the scorecard: "no secrets" and "no secrets, one allowed"
  // are different claims.
  assert.match(after.systems.sys.criteria['9'].findings[0], /1 allowed/);
});

test('an empty allowance list produces exactly the same data as no list at all', async () => {
  const base = {
    systems: [{ name: 'sys', sast_tool: 'semgrep' }],
    readReport: reader(reportsFor('config/dev.exs')),
    sastTool: 'semgrep',
    assessedAt: '2026-08-19',
    lastUpdated: '2026-08-19',
  };
  const omitted = await buildBenchmarkData(base);
  const empty = await buildBenchmarkData({ ...base, allowances: [] });
  assert.deepStrictEqual(empty, omitted);
});

test('the findings report keeps an allowed finding, and the tally never reaches ingest', async () => {
  const env = await buildFindingsForSystem({
    sys: { name: 'sys', stack: 'elixir', sast_tool: 'semgrep' },
    readReport: reader(reportsFor('config/dev.exs')),
    sastTool: 'semgrep',
    allowances: parseAllowances({
      allowances: [{
        criterion: 'security', sub: 'secrets', file: 'config/dev.exs', rule: 'private-key',
        reason: 'sample key committed for the test suite',
      }],
    }),
    generatedAt: '2026-08-19',
  });

  const groups = env.criteria['9'].groups;
  const allowed = groups.find((g) => g.disposition === 'allowed');
  assert.ok(allowed, 'an allowed finding must still appear in the report');
  assert.strictEqual(allowed.items[0].file, 'config/dev.exs');
  assert.strictEqual(allowed.items[0].allowed_reason, 'sample key committed for the test suite');
  // Whitelisted fields only — an allowed secret is still a secret.
  assert.deepStrictEqual(
    Object.keys(allowed.items[0]).sort(),
    ['allowed_reason', 'file', 'rule'],
  );
  // The confirmed group is gone entirely, because its only member was allowed.
  assert.ok(!groups.some((g) => g.disposition === 'confirmed'));

  // buildIngestPayload publishes findings.criteria and nothing else, so the
  // watchtower's own judgements stay in its repo rather than travelling to the
  // shared database.
  assert.strictEqual(env.allowances.length, 1);
  assert.strictEqual(env.allowances[0].matched, 1);
  assert.ok(!('allowances' in env.criteria));
});
