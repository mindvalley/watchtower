const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { splitAreas, keyOf, CONFIG_AREA, REST_AREA } = require('../../agents/oracle/areas');
const { fingerprint, placeFile } = require('../../agents/oracle/fingerprint');
const { runOracle, mergeGroups } = require('../../agents/oracle/pipeline');
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

// --- fingerprint ---------------------------------------------------------

test('fingerprints rest on the files named, not the wording', () => {
  assert.equal(placeFile('apps/web/src/lib/api-client.ts:21 (NEXT_PUBLIC_API_URL)'), 'apps/web/src/lib/api-client.ts');
  const a = fingerprint(['b.ts:3', 'a.ts (the port)']);
  const b = fingerprint(['./a.ts:9', 'b.ts']);
  assert.equal(a, b);
  assert.notEqual(a, fingerprint(['a.ts', 'c.ts']));
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

// --- pipeline end to end, with a scripted provider -------------------------

function scriptedProvider({ failArea } = {}) {
  return {
    conversation({ system }) {
      const kind = /Group findings/.test(system) ? 'merge' : /Check findings/.test(system) ? 'verify' : 'audit';
      return {
        async send(content) {
          const usage = { input: 1000, output: 200 };
          if (kind === 'audit') {
            const area = String(content).match(/starting area: (.*)\n/)?.[1] || '';
            if (failArea && area === failArea) return { toolCalls: [], text: '', stop: 'refusal', usage, model: 'm' };
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
            return { stop: 'tool', usage, model: 'm', text: '', toolCalls: [{ id: 'g', name: 'submit_groups', input: { groups: [items.map((i) => i.id)] } }] };
          }
          return { stop: 'tool', usage, model: 'm', text: '', toolCalls: [{ id: 'v', name: 'submit_verdicts', input: { verdicts: items.map((i) => ({ id: i.id, verdict: 'confirmed', note: 'read both' })) } }] };
        },
      };
    },
  };
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
