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

function run(files) {
  const listFile = path.join(os.tmpdir(), `c2rest-${process.pid}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(listFile, `${files.join('\n')}\n`);
  const helper = path.join(__dirname, '..', '..', 'scripts', 'benchmark', 'phoenix_swagger_desc_parse.exs');
  return JSON.parse(execFileSync('elixir', [helper, listFile], { encoding: 'utf8' }));
}

const fx = (f) => path.join(__dirname, 'fixtures', 'phoenix_swagger', f);

test('parses operations + parameters through quote nesting', { skip: elixirMissing() }, () => {
  const recs = run([fx('product_controller.ex')]);
  const ops = recs.filter((r) => r.kind === 'operation');
  const params = recs.filter((r) => r.kind === 'parameter');
  assert.strictEqual(ops.length, 1);
  assert.strictEqual(ops[0].has_description, true);
  assert.strictEqual(params.length, 3);
  assert.strictEqual(params.filter((p) => p.has_description).length, 2); // id, product; flag empty
});

test('parses schema properties, excludes type-level title/description', { skip: elixirMissing() }, () => {
  const recs = run([fx('product_schema.ex')]);
  const props = recs.filter((r) => r.kind === 'property');
  assert.strictEqual(props.length, 3);            // id, name, slug — NOT title/description
  assert.strictEqual(props.filter((p) => p.has_description).length, 2); // id, name; slug none
});

test('operation with no summary/description is undescribed', { skip: elixirMissing() }, () => {
  const recs = run([fx('no_desc_controller.ex')]);
  const ops = recs.filter((r) => r.kind === 'operation');
  assert.strictEqual(ops.length, 1);
  assert.strictEqual(ops[0].has_description, false);
  assert.strictEqual(recs.filter((r) => r.kind === 'parameter').length, 0);
});
