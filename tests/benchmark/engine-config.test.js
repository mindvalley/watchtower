const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  configPath, reportsRoot, loadConfig, systemConfig, reportsDir,
} = require('../../scripts/benchmark/engine-config');

// Every test sets the environment itself and puts it back, because these
// functions read process.env on each call by design — a long-running caller
// must be able to change target between scans.
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

function tmpConfig(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-config-'));
  const file = path.join(dir, 'watchtower.config.json');
  fs.writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents));
  return file;
}

const VALID = { systems: { alpha: { repo: 'acme/alpha', stack: 'ts', sast_tool: 'semgrep' } } };

test('locations come from the environment', () => {
  withEnv({ WATCHTOWER_CONFIG: '/tmp/x/list.json', WATCHTOWER_REPORTS: '/tmp/x/out' }, () => {
    assert.strictEqual(configPath(), '/tmp/x/list.json');
    assert.strictEqual(reportsRoot(), '/tmp/x/out');
  });
});

test('defaults let a standalone copy run from a project root with no setup', () => {
  withEnv({ WATCHTOWER_CONFIG: undefined, WATCHTOWER_REPORTS: undefined }, () => {
    assert.strictEqual(configPath(), path.resolve('watchtower.config.json'));
    assert.strictEqual(reportsRoot(), path.resolve('reports'));
  });
});

test('a readable config is returned', () => {
  withEnv({ WATCHTOWER_CONFIG: tmpConfig(VALID) }, () => {
    assert.deepStrictEqual(loadConfig(), VALID);
  });
});

// The whole point of the module. Each of these used to be either a crash with
// an unhelpful message or, worse, a scan of nothing that looked successful.
test('a missing config names the setting that fixes it', () => {
  withEnv({ WATCHTOWER_CONFIG: '/nonexistent/list.json' }, () => {
    assert.throws(() => loadConfig(), /WATCHTOWER_CONFIG/);
  });
});

test('malformed JSON is refused', () => {
  withEnv({ WATCHTOWER_CONFIG: tmpConfig('{ not json') }, () => {
    assert.throws(() => loadConfig(), /not valid JSON/);
  });
});

test('a config with no systems key is refused', () => {
  withEnv({ WATCHTOWER_CONFIG: tmpConfig({ nope: true }) }, () => {
    assert.throws(() => loadConfig(), /no "systems" object/);
  });
});

// An empty list must not read as "nothing to do". A run that scans nothing
// reports no findings, which is indistinguishable from a clean result.
test('an empty systems list is refused rather than treated as a clean run', () => {
  withEnv({ WATCHTOWER_CONFIG: tmpConfig({ systems: {} }) }, () => {
    assert.throws(() => loadConfig(), /lists no systems/);
  });
});

test('an unknown system lists the ones that do exist', () => {
  withEnv({ WATCHTOWER_CONFIG: tmpConfig(VALID) }, () => {
    assert.throws(() => systemConfig('ghost'), /Unknown system 'ghost'.*alpha/s);
  });
});

test('a system is returned with its settings intact', () => {
  withEnv({ WATCHTOWER_CONFIG: tmpConfig(VALID) }, () => {
    assert.deepStrictEqual(systemConfig('alpha'), VALID.systems.alpha);
  });
});

// The config file is the one thing that gets committed, so a credential in it
// is a credential in version control.
test('a credential in the config is refused', () => {
  const withToken = { systems: { alpha: { repo: 'acme/alpha', token: 'ghp_real' } } };
  withEnv({ WATCHTOWER_CONFIG: tmpConfig(withToken) }, () => {
    assert.throws(() => systemConfig('alpha'), /Credentials belong in the environment/);
  });
});

test('the reports folder is created on demand', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-out-'));
  withEnv({ WATCHTOWER_REPORTS: out }, () => {
    const dir = reportsDir('alpha');
    assert.strictEqual(dir, path.join(out, 'alpha'));
    assert.ok(fs.statSync(dir).isDirectory());
  });
});

// Importing a scan program must not require the caller's config to exist.
// Two programs used to read it at import time, which is why three test files
// failed to load rather than failing an assertion.
test('nothing is read at import time', () => {
  withEnv({ WATCHTOWER_CONFIG: '/nonexistent/list.json' }, () => {
    assert.doesNotThrow(() => {
      delete require.cache[require.resolve('../../scripts/benchmark/engine-config')];
      require('../../scripts/benchmark/engine-config');
    });
  });
});
