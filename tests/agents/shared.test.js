const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { treeTools, resolveInside } = require('../../agents/_shared/tools');
const { CostMeter, CostCapError } = require('../../agents/_shared/cost');
const { runAgent, mapLimit, AgentError } = require('../../agents/_shared/loop');
const { agentSettings, refuseCredentials } = require('../../agents/_shared/config');
const { createRunDir, previousRun, writeJson, stamp } = require('../../agents/_shared/runs');
const anthropic = require('../../agents/_shared/providers/anthropic');
const vertex = require('../../agents/_shared/providers/vertex');
const { checkProvider } = require('../../agents/_shared/providers');

function tmpTree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-agents-'));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  return root;
}

function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

// --- tools ---------------------------------------------------------------

test('tools refuse paths that leave the tree', () => {
  const root = tmpTree({ 'a.txt': 'x' });
  assert.throws(() => resolveInside(root, '../etc/passwd'), /escapes/);
  assert.throws(() => resolveInside(root, '/etc/passwd'), /escapes/);
  const tools = treeTools(root);
  const r = tools.run('read_file', { path: '../../x' });
  assert.equal(r.isError, true);
});

test('tools refuse a symlink that points outside the tree', () => {
  const outside = tmpTree({ 'secret.txt': 'nope' });
  const root = tmpTree({ 'a.txt': 'x' });
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));
  const r = treeTools(root).run('read_file', { path: 'link.txt' });
  assert.equal(r.isError, true);
  assert.match(r.output, /symlink/);
});

test('read_file numbers lines and says where to read on', () => {
  const body = Array.from({ length: 400 }, (_, i) => `line ${i + 1}`).join('\n');
  const root = tmpTree({ 'big.ts': body });
  const r = treeTools(root).run('read_file', { path: 'big.ts' });
  assert.equal(r.isError, false);
  assert.match(r.output, /^1\tline 1/);
  assert.match(r.output, /read on with start_line 301/);
});

test('search finds matches, skips node_modules, and reports none cleanly', () => {
  const root = tmpTree({
    'src/a.ts': 'const PORT = 3001;\n', 'node_modules/x/b.ts': 'const PORT = 3001;\n', 'docs/c.md': 'port 3001\n',
  });
  const tools = treeTools(root);
  const r = tools.run('search', { pattern: 'PORT = 300[0-9]' });
  assert.match(r.output, /src\/a\.ts:1:/);
  assert.doesNotMatch(r.output, /node_modules/);
  assert.equal(tools.run('search', { pattern: 'nothing-here-xyz' }).output, 'no matches');
  assert.match(tools.run('search', { pattern: '3001', glob: '*.md' }).output, /docs\/c\.md/);
});

test('list_files skips .git and build output', () => {
  const root = tmpTree({ 'src/a.ts': '', '.git/HEAD': '', 'dist/x.js': '' });
  const out = treeTools(root).run('list_files', {}).output;
  assert.match(out, /src\//);
  assert.doesNotMatch(out, /\.git|dist/);
});

// --- cost ----------------------------------------------------------------

test('cost meter prices tokens and stops before the cap', async () => {
  const m = new CostMeter({ prices: { m: { input: 4, output: 20, cache_read: 0.2, cache_write: 5 } }, capUsd: 1, reserveUsd: 0.25, model: 'm' });
  m.add({ input: 100_000, output: 10_000, cacheRead: 0, cacheWrite: 0 }, 'm'); // 0.4 + 0.2
  assert.equal(m.summary().usd, 0.6);
  const release = await m.beforeCall();
  m.add({ input: 50_000 }, 'other-model'); // priced as the configured model: 0.2
  release();
  await assert.rejects(m.beforeCall(), CostCapError);
});

test('a call next to a running one is held at the largest call seen, not the reserve', async () => {
  const m = new CostMeter({ prices: { m: { input: 1000, output: 0 } }, capUsd: 2.8, reserveUsd: 0.5, model: 'm' });
  const first = await m.beforeCall();
  m.add({ input: 1000 }, 'm'); // $1: the largest call so far
  first();
  const running = await m.beforeCall();
  // spent 1 + running 1 + reserve 0.5 = 2.5 would fit; + largest call 1 = 3 does not.
  let started = false;
  const next = m.beforeCall().then((release) => { started = true; return release; });
  await new Promise((r) => setImmediate(r));
  assert.equal(started, false, 'the second call started though the largest call seen does not fit');
  running(); // the running call fails: nothing spent, and now alone it fits
  (await next)();
  assert.equal(started, true);
});

test('a call that throws releases its hold on the cap', { timeout: 2000 }, async () => {
  const meter = new CostMeter({ prices: { m: { input: 1000, output: 0 } }, capUsd: 10, reserveUsd: 0.5, model: 'm' });
  let sends = 0;
  const provider = {
    conversation() {
      return {
        async send() {
          sends += 1;
          if (sends === 1) throw new Error('connection dropped');
          return { stop: 'tool', text: '', model: 'm', usage: { input: 1000, output: 0 }, toolCalls: [{ id: 's', name: 'submit_answer', input: { ok: true } }] };
        },
      };
    },
  };
  const go = () => runAgent({ provider, system: 's', prompt: 'go', tools: treeTools(tmpTree({ a: '' })), submit: SUBMIT, meter });
  // The second agent waits behind the first (no call has finished yet); it can
  // only start if the first agent's failed send gave its hold back.
  const [first, second] = await Promise.allSettled([go(), go()]);
  assert.equal(first.status, 'rejected');
  assert.match(first.reason.message, /connection dropped/);
  assert.deepEqual(second.value, { ok: true });
  assert.equal(meter.summary().usd, 1);
});

test('a cap with no price for the model is refused', () => {
  const m = new CostMeter({ prices: {}, capUsd: 5 });
  assert.throws(() => m.requirePrice('mystery'), /No price/);
  new CostMeter({ prices: {}, capUsd: null }).requirePrice('mystery');
});

// --- loop ----------------------------------------------------------------

function fakeProvider(script) {
  const calls = [];
  return {
    calls,
    conversation({ system, tools }) {
      let i = 0;
      return {
        async send(content) {
          calls.push({ system, tools: tools.map((t) => t.name), content });
          const step = script[i] || script[script.length - 1];
          i += 1;
          return { toolCalls: [], text: '', stop: 'end', usage: { input: 10, output: 5 }, model: 'm', ...step };
        },
      };
    },
  };
}

const SUBMIT = { name: 'submit_answer', description: 'd', input_schema: { type: 'object' } };

test('the loop runs tools until the agent submits, and returns the submission', async () => {
  const root = tmpTree({ 'a.ts': 'hello' });
  const p = fakeProvider([
    { stop: 'tool', toolCalls: [{ id: 't1', name: 'read_file', input: { path: 'a.ts' } }] },
    { stop: 'tool', toolCalls: [{ id: 't2', name: 'submit_answer', input: { ok: true } }] },
  ]);
  const meter = new CostMeter({});
  const out = await runAgent({ provider: p, system: 's', prompt: 'go', tools: treeTools(root), submit: SUBMIT, meter });
  assert.deepEqual(out, { ok: true });
  assert.match(p.calls[1].content[0].output, /hello/);
  assert.equal(meter.calls, 2);
});

test('the loop warns the agent ten turns before its limit, once', async () => {
  const root = tmpTree({ 'a.ts': 'x' });
  const p = fakeProvider([{ stop: 'tool', toolCalls: [{ id: 't', name: 'list_files', input: {} }] }]);
  const notes = [];
  const provider = {
    conversation(opts) {
      const c = p.conversation(opts);
      return { send: (content, extra) => { notes.push(extra && extra.note); return c.send(content); } };
    },
  };
  await assert.rejects(
    runAgent({ provider, system: 's', prompt: 'go', tools: treeTools(root), submit: SUBMIT, meter: new CostMeter({}), maxTurns: 15 }),
    /no answer after 15 turns/,
  );
  const warned = notes.map((n, i) => [n, i]).filter(([n]) => n);
  assert.equal(warned.length, 1);
  assert.equal(warned[0][1], 4); // turn 5 of 15: ten turns left
  assert.match(warned[0][0], /10 turns left.*submit_answer/);
});

test('the model is told it has ten turns left even if its previous reply was text', async () => {
  const root = tmpTree({ 'a.ts': 'x' });
  const listFiles = { stop: 'tool', toolCalls: [{ id: 't', name: 'list_files', input: {} }] };
  const p = fakeProvider([listFiles, listFiles, listFiles, { stop: 'end', text: 'thinking out loud' }, listFiles]);
  const notes = [];
  const provider = {
    conversation(opts) {
      const c = p.conversation(opts);
      return { send: (content, extra) => { notes.push(extra && extra.note); return c.send(content); } };
    },
  };
  await assert.rejects(
    runAgent({ provider, system: 's', prompt: 'go', tools: treeTools(root), submit: SUBMIT, meter: new CostMeter({}), maxTurns: 15 }),
    /no answer after 15 turns/,
  );
  assert.deepEqual(notes.filter(Boolean), [
    '10 turns left. Finish what you are checking and call submit_answer with what you have confirmed.',
  ]);
});

test('the loop nudges once, then fails an agent that never submits', async () => {
  const p = fakeProvider([{ stop: 'end', text: 'done!' }]);
  await assert.rejects(
    runAgent({ provider: p, system: 's', prompt: 'go', tools: treeTools(tmpTree({ a: '' })), submit: SUBMIT, meter: new CostMeter({}) }),
    AgentError,
  );
  assert.equal(p.calls.length, 2);
  assert.match(p.calls[1].content, /Call submit_answer now/);
});

test('the loop fails on a refusal or an output limit', async () => {
  for (const stop of ['refusal', 'limit']) {
    await assert.rejects(
      runAgent({ provider: fakeProvider([{ stop }]), system: 's', prompt: 'go', tools: treeTools(tmpTree({ a: '' })), submit: SUBMIT, meter: new CostMeter({}) }),
      AgentError,
    );
  }
});

test('mapLimit keeps order and caps concurrency', async () => {
  let inFlight = 0;
  let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
    inFlight += 1; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return n * 2;
  });
  assert.deepEqual(out, [2, 4, 6, 8, 10]);
  assert.equal(peak, 2);
});

test('concurrent agents do not exceed the cost cap', async () => {
  const meter = new CostMeter({ prices: { m: { input: 1000, output: 0 } }, capUsd: 1.2, reserveUsd: 0.5, model: 'm' });
  const provider = fakeProvider([{ stop: 'tool', toolCalls: [{ id: 's', name: 'submit_answer', input: {} }], usage: { input: 1000, output: 0 } }]);
  await mapLimit([1, 2, 3], 3, () => runAgent({
    provider, system: 's', prompt: 'go', tools: treeTools(tmpTree({ a: '' })), submit: SUBMIT, meter,
  }).catch((err) => { if (!(err instanceof CostCapError)) throw err; }));
  assert.ok(meter.summary().usd <= 1.2, `spent $${meter.summary().usd} against a $1.20 cap`);
});

// --- config --------------------------------------------------------------

function agentDir(settings) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-agent-'));
  fs.writeFileSync(path.join(dir, 'agent.json'), JSON.stringify({ settings }));
  return dir;
}

function configFile(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-config-'));
  const file = path.join(dir, 'watchtower.config.json');
  fs.writeFileSync(file, JSON.stringify(contents));
  return file;
}

test('settings merge: agent defaults < fleet config < system override', () => {
  const dir = agentDir({ provider: 'anthropic', model: 'a', key_env: 'K', max_areas: 9, pull_requests: false });
  const file = configFile({
    agents: { oracle: { model: 'b', systems: ['web'] } },
    systems: { web: { path: '.', stack: 'ts', agents: { oracle: { pull_requests: true } } } },
  });
  withEnv({ WATCHTOWER_CONFIG: file, K: 'value' }, () => {
    const { settings } = agentSettings('oracle', 'web', { agentDir: dir });
    assert.equal(settings.model, 'b');
    assert.equal(settings.max_areas, 9);
    assert.equal(settings.pull_requests, true);
    assert.equal(settings.systems, undefined);
  });
});

test('settings refuse a credential in the config, a missing key, and an unlisted system', () => {
  const dir = agentDir({ provider: 'anthropic', model: 'a', key_env: 'K' });
  assert.throws(() => refuseCredentials({ api_key: 'x' }, 'here'), /credential/);
  assert.throws(() => refuseCredentials({ note: 'sk-ant-abcdefghijklmnopqrst' }, 'here'), /credential/);

  const file = configFile({ agents: { oracle: { systems: ['other'] } }, systems: { web: { path: '.', stack: 'ts' }, other: { path: '.', stack: 'ts' } } });
  withEnv({ WATCHTOWER_CONFIG: file, K: 'value' }, () => {
    assert.throws(() => agentSettings('oracle', 'web', { agentDir: dir }), /not in agents\.oracle\.systems/);
  });
  withEnv({ WATCHTOWER_CONFIG: file, K: undefined }, () => {
    assert.throws(() => agentSettings('oracle', 'other', { agentDir: dir }), /K is not set/);
  });
  const none = configFile({ systems: { web: { path: '.', stack: 'ts' } } });
  withEnv({ WATCHTOWER_CONFIG: none, K: 'v' }, () => {
    assert.throws(() => agentSettings('oracle', 'web', { agentDir: dir }), /no "agents\.oracle" section/);
  });
});

// --- runs ----------------------------------------------------------------

test('run folders are dated, never overwritten, and the previous run is found', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-runs-'));
  const date = new Date(Date.UTC(2026, 10, 16, 9, 5));
  assert.equal(stamp(date), '2026-11-16-0905');
  const a = createRunDir('oracle', 'web', { date, root });
  writeJson(a, 'run.json', {});
  const b = createRunDir('oracle', 'web', { date, root });
  assert.notEqual(a, b);
  assert.equal(previousRun('oracle', 'web', b, { root }), a);
  assert.equal(previousRun('oracle', 'none', b, { root }), null);
});

test('the previous run can be required to hold a file, so a run that crashed early is skipped', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-runs-'));
  const at = (h) => createRunDir('oracle', 'web', { date: new Date(Date.UTC(2026, 10, 16, h)), root });
  const good = at(1);
  writeJson(good, 'run.json', {});
  writeJson(good, 'findings.json', { findings: [] });
  const crashed = at(2);
  writeJson(crashed, 'run.json', { status: 'failed' });
  const current = at(3);
  assert.equal(previousRun('oracle', 'web', current, { root }), crashed);
  assert.equal(previousRun('oracle', 'web', current, { root, needs: 'findings.json' }), good);
});

// --- anthropic adapter ---------------------------------------------------

test('anthropic adapter sends cached, streamed requests (fallbacks when asked) and maps the reply', async () => {
  const sent = [];
  const client = {
    beta: {
      messages: {
        stream(params) {
          sent.push(JSON.parse(JSON.stringify(params)));
          return {
            finalMessage: async () => ({
              model: 'claude-opus-5-5',
              stop_reason: 'tool_use',
              content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'looking' }, { type: 'tool_use', id: 'tu1', name: 'search', input: { pattern: 'x' } }],
              usage: { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 },
            }),
          };
        },
      },
    },
  };
  const p = anthropic.create({ model: 'claude-opus-5-5', key_env: 'K', fallbacks: true }, { client });
  const convo = p.conversation({ system: 'sys', tools: [{ name: 'search', description: 'd', input_schema: { type: 'object' } }] });
  const turn = await convo.send('start');
  assert.equal(turn.stop, 'tool');
  assert.deepEqual(turn.toolCalls, [{ id: 'tu1', name: 'search', input: { pattern: 'x' } }]);
  assert.deepEqual(turn.usage, { input: 7, output: 3, cacheRead: 100, cacheWrite: 20 });
  assert.equal(sent[0].fallbacks, 'default');
  assert.deepEqual(sent[0].betas, ['server-side-fallback-2026-07-01']);
  assert.deepEqual(sent[0].cache_control, { type: 'ephemeral' });

  await convo.send([{ id: 'tu1', output: 'found', isError: false }], { note: 'wrap up' });
  const second = sent[1].messages;
  assert.equal(second[1].role, 'assistant');
  assert.equal(second[1].content[0].type, 'thinking'); // passed back unchanged
  assert.deepEqual(second[2].content, [{ type: 'tool_result', tool_use_id: 'tu1', content: 'found' }, { type: 'text', text: 'wrap up' }]);
});

function recordingClient(sent) {
  return { beta: { messages: { stream: (p) => { sent.push(p); return { finalMessage: async () => ({ stop_reason: 'end_turn', content: [], usage: {} }) }; } } } };
}

test('fallbacks are off by default, and only on models that have them', async () => {
  const sent = [];
  const client = recordingClient(sent);
  await anthropic.create({ model: 'claude-opus-5-5', key_env: 'K' }, { client }).conversation({ system: 's', tools: [] }).send('x');
  await anthropic.create({ model: 'claude-haiku-5-5', key_env: 'K', fallbacks: true }, { client }).conversation({ system: 's', tools: [] }).send('x');
  assert.equal(sent[0].fallbacks, undefined);
  assert.equal(sent[1].fallbacks, undefined);
});

test('vertex needs no key, only the project variable, and never asks for fallbacks', async () => {
  assert.equal(vertex.check({}, { ANTHROPIC_VERTEX_PROJECT_ID: 'proj' }), null);
  assert.match(vertex.check({}, {}), /ANTHROPIC_VERTEX_PROJECT_ID is not set/);
  assert.match(vertex.check({ project_env: 'MY_PROJ' }, {}), /MY_PROJ is not set/);
  assert.doesNotThrow(() => checkProvider({ provider: 'vertex' }, { ANTHROPIC_VERTEX_PROJECT_ID: 'p' }));
  assert.throws(() => checkProvider({ provider: 'anthropic', key_env: 'K' }, {}), /K is not set/);
  assert.throws(() => checkProvider({ provider: 'mystery' }, {}), /Unknown provider/);

  const sent = [];
  const p = vertex.create({ model: 'claude-opus-5-5', fallbacks: true }, { client: recordingClient(sent) });
  assert.equal(p.name, 'vertex');
  await p.conversation({ system: 's', tools: [] }).send('x');
  assert.equal(sent[0].fallbacks, undefined);
  assert.equal(sent[0].model, 'claude-opus-5-5');
  assert.deepEqual(sent[0].cache_control, { type: 'ephemeral' });
});

// --- submitted answers are checked against the submit tool's schema ----------

const { SUBMIT_FINDINGS } = require('../../agents/oracle/schemas');
const { checkInput } = require('../../agents/_shared/loop');
const VALID = { findings: [{ places: ['a.ts'], agreement: 'x', unguarded: 'u', trigger: 't', effect: 'e', fix: 'f', likelihood: 'high', harm: 'low' }], current_bugs: [] };

test('a submission is checked against the schema, down to the items', () => {
  const schema = SUBMIT_FINDINGS.input_schema;
  assert.equal(checkInput(schema, VALID), null);
  assert.match(checkInput(schema, { ...VALID, findings: JSON.stringify(VALID.findings) }), /findings must be an array/);
  assert.match(checkInput(schema, { findings: [] }), /current_bugs is required/);
  assert.match(checkInput(schema, { ...VALID, findings: [{ ...VALID.findings[0], likelihood: 'huge' }] }), /findings\[0\]\.likelihood must be one of/);
  assert.match(checkInput(schema, { ...VALID, findings: [{ ...VALID.findings[0], places: [] }] }), /findings\[0\]\.places needs at least 1/);
});

test('a malformed submission is sent back with the reason, and the corrected one is returned', async () => {
  const p = fakeProvider([
    { stop: 'tool', toolCalls: [{ id: 's1', name: 'submit_findings', input: { ...VALID, findings: JSON.stringify(VALID.findings) } }] },
    { stop: 'tool', toolCalls: [{ id: 's2', name: 'submit_findings', input: VALID }] },
  ]);
  const out = await runAgent({ provider: p, system: 's', prompt: 'go', tools: treeTools(tmpTree({ a: '' })), submit: SUBMIT_FINDINGS, meter: new CostMeter({}) });
  assert.deepEqual(out, VALID);
  const [back] = p.calls[1].content;
  assert.equal(back.id, 's1');
  assert.equal(back.isError, true);
  assert.match(back.output, /findings must be an array/);
});

test('an agent that submits a malformed answer twice fails cleanly, not later downstream', async () => {
  const bad = { stop: 'tool', toolCalls: [{ id: 's', name: 'submit_findings', input: { findings: 'oops', current_bugs: [] } }] };
  await assert.rejects(
    runAgent({ provider: fakeProvider([bad, bad]), system: 's', prompt: 'go', tools: treeTools(tmpTree({ a: '' })), submit: SUBMIT_FINDINGS, meter: new CostMeter({}) }),
    (err) => err instanceof AgentError && /malformed answer/.test(err.message),
  );
});
