const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { splitAreas, keyOf, CONFIG_AREA, REST_AREA } = require('../../agents/oracle/areas');
const { fingerprint, placeFile } = require('../../agents/oracle/fingerprint');
const { runOracle, mergeGroups } = require('../../agents/oracle/pipeline');
const { renderReport } = require('../../agents/oracle/report');
const { CostMeter } = require('../../agents/_shared/cost');

const AGENT_DIR = path.join(__dirname, '../../agents/oracle');
const DEFAULTS = JSON.parse(fs.readFileSync(path.join(AGENT_DIR, 'agent.json'), 'utf8'));

// --- areas ---------------------------------------------------------------

test('root files and operations directories form one config area', () => {
  assert.equal(keyOf('package.json'), CONFIG_AREA);
  assert.equal(keyOf('.github/workflows/ci.yml'), CONFIG_AREA);
  assert.equal(keyOf('docker/compose.yml'), CONFIG_AREA);
  assert.equal(keyOf('apps/web/src/a.ts'), 'apps/web');
  assert.equal(keyOf('src/a.ts'), 'src');
});

test('largest keys get their own area, the rest share one, every file is covered', () => {
  const files = ['package.json', '.github/ci.yml'];
  const sizes = { 'apps/api': 50, 'apps/web': 30, 'apps/admin': 10, 'packages/ui': 5, 'packages/db': 3 };
  for (const [k, n] of Object.entries(sizes)) for (let i = 0; i < n; i += 1) files.push(`${k}/src/f${i}.ts`);
  const areas = splitAreas(files, { maxAreas: 4 });
  const names = areas.map((a) => a.name);
  assert.ok(names.includes(CONFIG_AREA));
  assert.ok(names.includes(REST_AREA));
  assert.ok(areas.length <= 4);
  assert.equal(areas.reduce((s, a) => s + a.files, 0), files.length);
});

test('an oversized area is split in two when there is room', () => {
  const files = [];
  for (let i = 0; i < 120; i += 1) files.push(`apps/api/src/domains/d${i % 6}/f${i}.ts`);
  for (let i = 0; i < 10; i += 1) files.push(`apps/web/src/f${i}.ts`);
  const areas = splitAreas(files, { maxAreas: 6 });
  assert.ok(areas.some((a) => a.name.startsWith('apps/api (1 of 2)')));
  assert.equal(areas.reduce((s, a) => s + a.files, 0), files.length);
});

test('repeated splits never lose or duplicate a file', () => {
  const files = ['package.json', 'apps/api/README.md', 'apps/api/scripts/seed.ts', 'apps/api/src/main.ts'];
  for (let d = 0; d < 12; d += 1) for (let i = 0; i < 25 + d * 5; i += 1) files.push(`apps/api/src/domains/d${d}/f${i}.ts`);
  for (let i = 0; i < 30; i += 1) files.push(`apps/api/src/common/c${i}.ts`);
  for (let i = 0; i < 60; i += 1) files.push(`apps/web/src/f${i}.ts`);
  for (const maxAreas of [3, 5, 9, 14]) {
    const areas = splitAreas(files, { maxAreas });
    assert.equal(areas.reduce((s, a) => s + a.files, 0), files.length, `maxAreas ${maxAreas}`);
    assert.ok(areas.length <= maxAreas, `maxAreas ${maxAreas}`);
  }
  // The api folder is split below src/domains, with what was stepped past kept.
  const areas = splitAreas(files, { maxAreas: 9 });
  assert.ok(areas.some((a) => a.paths.some((p) => p.endsWith('(other files)'))));
});

// --- fingerprint ---------------------------------------------------------

test('fingerprints rest on the files named, not the wording', () => {
  assert.equal(placeFile('apps/web/src/lib/api-client.ts:21 (NEXT_PUBLIC_API_URL)'), 'apps/web/src/lib/api-client.ts');
  const a = fingerprint(['b.ts:3', 'a.ts (the port)']);
  const b = fingerprint(['./a.ts:9', 'b.ts']);
  assert.equal(a, b);
  assert.notEqual(a, fingerprint(['a.ts', 'c.ts']));
});

test('folders can have parenthesis in their names', () => {
  assert.equal(placeFile('app/(marketing)/page.tsx:12'), 'app/(marketing)/page.tsx');
});

// --- merge ---------------------------------------------------------------

test('merge unions places, keeps the strongest rating, and never drops a finding', () => {
  const findings = [
    { id: 'x#1', places: ['a.ts'], agreement: 'port', likelihood: 'low', harm: 'high', unguarded: '', trigger: '', effect: '', fix: '' },
    { id: 'y#1', places: ['a.ts', 'b.ts'], agreement: 'port too', likelihood: 'high', harm: 'medium', unguarded: '', trigger: '', effect: '', fix: '' },
    { id: 'z#1', places: ['c.ts'], agreement: 'other', likelihood: 'medium', harm: 'low', unguarded: '', trigger: '', effect: '', fix: '' },
  ];
  const merged = mergeGroups(findings, [['x#1', 'y#1', 'ghost'], ['x#1']]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0].places.sort(), ['a.ts', 'b.ts']);
  assert.equal(merged[0].likelihood, 'high');
  assert.equal(merged[0].harm, 'high');
  assert.deepEqual(merged[0].found_by, ['x#1', 'y#1']);
  assert.deepEqual(merged[1].found_by, ['z#1']);
});

// --- report --------------------------------------------------------------

test('the findings table escapes backslashes and pipes', () => {
  const finding = {
    agreement: 'path C:\\tmp | port', places: ['a.ts'], likelihood: 'high', harm: 'low', fingerprint: 'abc',
    unguarded: '', trigger: '', effect: '', fix: '', verification: { verdict: 'confirmed', note: '' },
  };
  const run = {
    system: 'web', status: 'complete', commit: 'abc', provider: 'anthropic', model: 'm', prompt_version: '1',
    cost: { usd: 0, calls: 0 }, started_at: '2026-11-20T00:00:00Z', not_audited: [], problems: [],
    counts: { findings: 1, confirmed: 1, rejected: 0, current_bugs: 0, security_bugs: 0 },
  };
  const report = renderReport({ run, findings: [finding], rejected: [], bugs: [], areas: [{ name: 'src' }] });
  assert.ok(report.includes('| 1 | path C:\\\\tmp \\| port | high | low | confirmed |'), report);
});

// --- pipeline end to end, with a scripted provider -------------------------

function scriptedProvider({ failArea, flakyArea, mergeApart, reject, tooLongArea, failCompare, recheck = {} } = {}) {
  let flaked = false;
  const provider = {
    tooLongAttempts: 0,
    calls: { compare: 0, recheck: 0 },
    conversation({ system }) {
      const kind = /Group findings/.test(system) ? 'merge' : /Check findings/.test(system) ? 'verify'
        : /Match findings/.test(system) ? 'compare' : /Re-check findings/.test(system) ? 'recheck' : 'audit';
      return {
        async send(content) {
          const usage = { input: 1000, output: 200 };
          if (kind === 'compare') {
            provider.calls.compare += 1;
            if (failCompare) return { toolCalls: [], text: '', stop: 'refusal', usage, model: 'm' };
            // Same agreement text = same agreement.
            const { previous, current } = JSON.parse(content);
            const matches = current.map((c) => ({ current: c.id, previous: previous.filter((p) => p.agreement === c.agreement).map((p) => p.id) }))
              .filter((m) => m.previous.length);
            return { stop: 'tool', usage, model: 'm', text: '', toolCalls: [{ id: 'c', name: 'submit_matches', input: { matches } }] };
          }
          if (kind === 'recheck') {
            provider.calls.recheck += 1;
            const items = JSON.parse(content);
            const statuses = items.map((i) => ({ id: i.id, status: recheck[i.agreement] || 'still_open', note: 'read it' }));
            return { stop: 'tool', usage, model: 'm', text: '', toolCalls: [{ id: 'r', name: 'submit_statuses', input: { statuses } }] };
          }
          if (kind === 'audit') {
            const area = String(content).match(/starting area: (.*)\n/)?.[1] || '';
            if (failArea && area === failArea) return { toolCalls: [], text: '', stop: 'refusal', usage, model: 'm' };
            if (flakyArea && area === flakyArea && !flaked) { flaked = true; throw new Error('Unable to complete this request right now'); }
            if (tooLongArea && area === tooLongArea) {
              provider.tooLongAttempts += 1;
              throw Object.assign(new Error('prompt is too long'), { status: 400 });
            }
            return {
              stop: 'tool', usage, model: 'm', text: '',
              toolCalls: [{
                id: 's', name: 'submit_findings', input: {
                  findings: [{ places: ['package.json', 'src/a.ts:1'], agreement: `port copied (${area})`, unguarded: 'no shared const', trigger: 'change one', effect: 'e2e fails', fix: 'shared const', likelihood: 'high', harm: 'medium' }],
                  current_bugs: area === CONFIG_AREA ? [{ places: ['src/a.ts'], what: 'open endpoint', security: true }, { places: ['package.json'], what: 'stale doc' }] : [],
                },
              }],
            };
          }
          const items = JSON.parse(content);
          if (kind === 'merge') {
            const groups = mergeApart ? items.map((i) => [i.id]) : [items.map((i) => i.id)];
            return { stop: 'tool', usage, model: 'm', text: '', toolCalls: [{ id: 'g', name: 'submit_groups', input: { groups } }] };
          }
          return { stop: 'tool', usage, model: 'm', text: '', toolCalls: [{ id: 'v', name: 'submit_verdicts', input: { verdicts: items.map((i) => ({ id: i.id, verdict: reject && i.agreement.includes(reject) ? 'rejected' : 'confirmed', note: 'read both' })) } }] };
        },
      };
    },
  };
  return provider;
}

function fixtureTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-oracle-tree-'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"scripts":{"dev":"next dev -p 3000"}}');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/a.ts'), 'export const PORT = 3000;\n');
  return root;
}

const SETTINGS = { ...DEFAULTS.settings, concurrency: 2 };

test('a full run writes every file, merges duplicates, verifies, and puts security bugs first', async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-oracle-run-'));
  const run = await runOracle({
    systemKey: 'web', settings: SETTINGS, defaults: DEFAULTS, agentDir: AGENT_DIR,
    provider: scriptedProvider(), treeDir: fixtureTree(), runDir, meter: new CostMeter({ prices: SETTINGS.prices, model: 'claude-opus-5-5' }), commit: 'abc',
  });
  assert.equal(run.status, 'complete');
  assert.equal(run.areas[0], CONFIG_AREA, 'config and operations is audited first');
  for (const f of ['areas.json', 'findings.json', 'bugs.json', 'run.json', 'report.md']) assert.ok(fs.existsSync(path.join(runDir, f)), f);
  assert.equal(run.counts.raw_findings, 2);
  assert.equal(run.counts.findings, 1);
  assert.equal(run.counts.confirmed, 1);
  const bugs = JSON.parse(fs.readFileSync(path.join(runDir, 'bugs.json'), 'utf8')).bugs;
  assert.equal(bugs[0].security, true);
  const report = fs.readFileSync(path.join(runDir, 'report.md'), 'utf8');
  assert.match(report, /^# Oracle — web/);
  assert.match(report, /\*\*Security\.\*\* open endpoint/);
});

test('a failed auditor marks its area not audited and the run failed — never clean', async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-oracle-run-'));
  const run = await runOracle({
    systemKey: 'web', settings: SETTINGS, defaults: DEFAULTS, agentDir: AGENT_DIR,
    provider: scriptedProvider({ failArea: 'src' }), treeDir: fixtureTree(), runDir, meter: new CostMeter({}),
  });
  assert.equal(run.status, 'failed');
  assert.deepEqual(run.not_audited, ['src']);
  assert.match(fs.readFileSync(path.join(runDir, 'report.md'), 'utf8'), /\*\*Not audited:\*\* src/);
});

test('a transient provider error is retried once, and the area is still audited', async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-oracle-run-'));
  const run = await runOracle({
    systemKey: 'web', settings: SETTINGS, defaults: DEFAULTS, agentDir: AGENT_DIR,
    provider: scriptedProvider({ flakyArea: 'src' }), treeDir: fixtureTree(), runDir, meter: new CostMeter({}),
  });
  assert.equal(run.status, 'complete');
  assert.deepEqual(run.not_audited, []);
});

test('the spending cap stops the run as incomplete, with what was done kept', async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-oracle-run-'));
  const meter = new CostMeter({ prices: { m: { input: 4000, output: 20000 } }, capUsd: 5, reserveUsd: 0, model: 'm' });
  const run = await runOracle({
    systemKey: 'web', settings: { ...SETTINGS, concurrency: 1 }, defaults: DEFAULTS, agentDir: AGENT_DIR,
    provider: scriptedProvider(), treeDir: fixtureTree(), runDir, meter,
  });
  assert.equal(run.status, 'incomplete');
  assert.ok(run.counts.raw_findings >= 1);
  assert.match(fs.readFileSync(path.join(runDir, 'report.md'), 'utf8'), /stopped at the spending cap/);
});

test('"failed" status is not overriden by "incomplete"', async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-oracle-run-'));
  const meter = new CostMeter({ prices: { m: { input: 4000, output: 20000 } }, capUsd: 5, reserveUsd: 0, model: 'm' });
  const run = await runOracle({
    systemKey: 'web', settings: { ...SETTINGS, concurrency: 1 }, defaults: DEFAULTS, agentDir: AGENT_DIR,
    provider: scriptedProvider({ failArea: CONFIG_AREA }), treeDir: fixtureTree(), runDir, meter,
  });
  assert.deepEqual(run.not_audited, [CONFIG_AREA, 'src']);
  assert.ok(run.problems.some((p) => p.includes('model declined')));
  assert.equal(run.status, 'failed');
});

test('two findings in the same file report separately', async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-oracle-run-'));
  await runOracle({
    systemKey: 'web', settings: SETTINGS, defaults: DEFAULTS, agentDir: AGENT_DIR,
    provider: scriptedProvider({ mergeApart: true, reject: '(src)' }), treeDir: fixtureTree(), runDir, meter: new CostMeter({}),
  });
  const { findings, rejected } = JSON.parse(fs.readFileSync(path.join(runDir, 'findings.json'), 'utf8'));
  const verdicts = Object.fromEntries([...findings, ...rejected].map((f) => [f.agreement, f.verification.verdict]));
  assert.deepEqual(verdicts, {
    'port copied (config and operations)': 'confirmed',
    'port copied (src)': 'rejected',
  });
});

test('an area is not retried after the model says the conversation is too long', async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-oracle-run-'));
  const provider = scriptedProvider({ tooLongArea: 'src' });
  await runOracle({
    systemKey: 'web', settings: SETTINGS, defaults: DEFAULTS, agentDir: AGENT_DIR,
    provider, treeDir: fixtureTree(), runDir, meter: new CostMeter({}),
  });
  assert.equal(provider.tooLongAttempts, 1);
});

// --- step 5: compare with the previous run --------------------------------

const PORT = 'port copied (config and operations)';
const earlier = (id, agreement, places) => ({
  id, fingerprint: id, agreement, places, likelihood: 'high', harm: 'medium', unguarded: 'u', trigger: 't', effect: 'e', fix: 'f',
  verification: { verdict: 'confirmed', note: '' }, first_seen: { run: '2026-11-10-0300', commit: 'aaa' },
});
const PREVIOUS = {
  dir: '/runs/oracle/web/2026-11-18-0300', run: '2026-11-18-0300', commit: 'aaa',
  open: [
    earlier('keep1', PORT, ['package.json', 'src/a.ts']),
    earlier('carry1', 'docs table copied', ['docs/env.md']),
    earlier('gone1', 'stale env name', ['src/a.ts:2']),
  ],
};
const readRun = (runDir, f) => JSON.parse(fs.readFileSync(path.join(runDir, f), 'utf8'));

async function runWithPrevious(providerOpts, { previous = PREVIOUS, changed = new Set(['src/a.ts']) } = {}) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-oracle-run-'));
  const provider = scriptedProvider(providerOpts);
  const run = await runOracle({
    systemKey: 'web', settings: SETTINGS, defaults: DEFAULTS, agentDir: AGENT_DIR, provider, treeDir: fixtureTree(),
    runDir, meter: new CostMeter({}), commit: 'bbb', previous, changedSince: () => changed,
  });
  return { run, runDir, provider };
}

test('a first run has nothing to compare: every finding is new, with its fingerprint as its id', async () => {
  const { run, runDir, provider } = await runWithPrevious({}, { previous: null });
  const changes = readRun(runDir, 'changes.json');
  assert.equal(changes.previous, null);
  const [f] = readRun(runDir, 'findings.json').findings;
  assert.equal(f.id, f.fingerprint);
  assert.equal(f.change, 'new');
  assert.equal(run.changes.new, 1);
  assert.equal(provider.calls.compare, 0);
  assert.match(fs.readFileSync(path.join(runDir, 'report.md'), 'utf8'), /First run/);
});

test('against the previous run: found again keeps its id, unchanged is carried, changed is re-checked', async () => {
  const { run, runDir, provider } = await runWithPrevious({ recheck: { 'stale env name': 'fixed' } });
  const [f] = readRun(runDir, 'findings.json').findings;
  assert.equal(f.id, 'keep1');
  assert.equal(f.change, 'still_open');
  const changes = readRun(runDir, 'changes.json');
  assert.equal(changes.previous.run, '2026-11-18-0300');
  assert.deepEqual(changes.carried.map((c) => c.id), ['carry1'], 'unchanged files: carried, still open');
  const status = Object.fromEntries(changes.earlier.map((e) => [e.id, e.status]));
  assert.deepEqual(status, { keep1: 'still_open', carry1: 'still_open', gone1: 'fixed' });
  assert.equal(provider.calls.recheck, 1, 'only the finding whose files changed is re-checked');
  assert.deepEqual(run.changes, { new: 0, still_open: 2, merged: 0, fixed: 1, guarded: 0, broke: 0, open: 2 });
  const report = fs.readFileSync(path.join(runDir, 'report.md'), 'utf8');
  assert.match(report, /## Since the previous run/);
  assert.match(report, /Fixed.*stale env name/s);
});

test('a re-check that finds the agreement broken closes it as broke and says so first', async () => {
  const { run, runDir } = await runWithPrevious({ recheck: { 'stale env name': 'broke' } });
  assert.equal(run.changes.broke, 1);
  const report = fs.readFileSync(path.join(runDir, 'report.md'), 'utf8');
  assert.ok(report.indexOf('Broke') < report.indexOf('Fixed') || !report.includes('Fixed'), 'broke is listed before fixed');
});

test('an unsure re-check keeps the finding open', async () => {
  const { runDir } = await runWithPrevious({ recheck: { 'stale env name': 'unsure' } });
  const changes = readRun(runDir, 'changes.json');
  assert.deepEqual(changes.carried.map((c) => c.id).sort(), ['carry1', 'gone1']);
});

test('if the comparison fails, every earlier finding stays open and nothing is marked fixed', async () => {
  const { run, runDir } = await runWithPrevious({ failCompare: true, recheck: { 'stale env name': 'fixed' } });
  assert.equal(run.status, 'failed');
  assert.ok(run.problems.some((p) => p.startsWith('compare')));
  const changes = readRun(runDir, 'changes.json');
  assert.equal(changes.compared, false);
  assert.deepEqual(changes.carried.map((c) => c.id).sort(), ['carry1', 'gone1', 'keep1']);
  assert.equal(run.changes.fixed, 0);
});

test('when what changed is unknown, unmatched findings are re-checked, not assumed unchanged', async () => {
  const { provider, runDir } = await runWithPrevious({}, { changed: null });
  assert.equal(provider.calls.recheck, 1);
  assert.deepEqual(readRun(runDir, 'changes.json').carried.map((c) => c.id).sort(), ['carry1', 'gone1']);
});
