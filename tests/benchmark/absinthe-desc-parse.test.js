const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function elixirMissing() {
  try { execFileSync('elixir', ['--version'], { stdio: 'ignore' }); return false; }
  catch { return 'elixir not installed — skipping AST helper test'; }
}

test('absinthe_desc_parse emits field records with description flags', { skip: elixirMissing() }, () => {
  const fixtures = path.join(__dirname, 'fixtures', 'absinthe');
  const files = ['user_types.ex', 'root_types.ex'].map((f) => path.join(fixtures, f));
  const listFile = path.join(os.tmpdir(), `c2-list-${process.pid}.txt`);
  fs.writeFileSync(listFile, `${files.join('\n')}\n`);
  const helper = path.join(__dirname, '..', '..', 'scripts', 'benchmark', 'absinthe_desc_parse.exs');
  const out = execFileSync('elixir', [helper, listFile], { encoding: 'utf8' });
  const recs = JSON.parse(out);

  assert.strictEqual(recs.length, 7);
  assert.strictEqual(recs.filter((r) => r.has_description).length, 4);

  const key = (r) => `${r.type}.${r.field}=${r.has_description}`;
  const got = recs.map(key).sort();
  const want = [
    'user.id=false', 'user.email=true', 'user.name=true', 'user.bio=true',
    'user_filter.active=false', 'query.users=true', 'query.user=false',
  ].sort();
  assert.deepStrictEqual(got, want);
});

test('absinthe_desc_parse counts unquote-named fields without crashing', { skip: elixirMissing() }, () => {
  // Regression: Absinthe metaprogramming (`object unquote(name) do`,
  // `field unquote(f), :t`) yields AST tuples as names. The parser must count
  // these public fields, not raise Protocol.UndefinedError on to_string/1.
  const fixtures = path.join(__dirname, 'fixtures', 'absinthe');
  const listFile = path.join(os.tmpdir(), `c2-dyn-${process.pid}.txt`);
  fs.writeFileSync(listFile, `${path.join(fixtures, 'dynamic_types.ex')}\n`);
  const helper = path.join(__dirname, '..', '..', 'scripts', 'benchmark', 'absinthe_desc_parse.exs');
  const recs = JSON.parse(execFileSync('elixir', [helper, listFile], { encoding: 'utf8' }));

  assert.strictEqual(recs.length, 2); // both fields counted (denominator intact)
  assert.strictEqual(recs.filter((r) => r.has_description).length, 1); // dyn_field has inline description:
  // the unquote'd names collapse to a safe "(dynamic)" label, never crash
  assert.ok(recs.every((r) => typeof r.field === 'string' && typeof r.type === 'string'));
});

test('absinthe_desc_parse excludes interface blocks from the denominator', { skip: elixirMissing() }, () => {
  // Spec §2: denominator is object/input_object/root fields only. Implementing
  // objects re-declare interface fields, so counting the interface too would
  // double-count. A standalone interface block must yield zero records.
  const fixtures = path.join(__dirname, 'fixtures', 'absinthe');
  const listFile = path.join(os.tmpdir(), `c2-iface-${process.pid}.txt`);
  fs.writeFileSync(listFile, `${path.join(fixtures, 'interface_types.ex')}\n`);
  const helper = path.join(__dirname, '..', '..', 'scripts', 'benchmark', 'absinthe_desc_parse.exs');
  const recs = JSON.parse(execFileSync('elixir', [helper, listFile], { encoding: 'utf8' }));
  assert.strictEqual(recs.length, 0);
});
