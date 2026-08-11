// tests/benchmark/openapi-reader.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { parseOpenApi, parseOpenApiText, isOpenApiSpec } = require('../../scripts/benchmark/openapi-reader');

const count = (recs, kind) => recs.filter((r) => r.kind === kind).length;
const described = (recs, kind) => recs.filter((r) => r.kind === kind && r.has_description).length;

test('operations: described when description OR summary is non-empty', () => {
  const recs = parseOpenApi({
    openapi: '3.0.0',
    paths: {
      '/a': { get: { summary: 'gets a' }, post: {} },
      '/b': { get: { description: 'gets b' } },
    },
  });
  assert.strictEqual(count(recs, 'operation'), 3);
  assert.strictEqual(described(recs, 'operation'), 2); // /a get (summary) + /b get (description)
});

test('parameters: operation-level and path-item-level, $ref resolved to components', () => {
  const recs = parseOpenApi({
    openapi: '3.0.0',
    components: { parameters: { PageParam: { name: 'page', description: 'the page' } } },
    paths: {
      '/x': {
        parameters: [{ name: 'shared', description: 'shared one' }],
        get: { parameters: [{ name: 'q' }, { $ref: '#/components/parameters/PageParam' }] },
      },
    },
  });
  assert.strictEqual(count(recs, 'parameter'), 3); // shared + q + PageParam(ref)
  assert.strictEqual(described(recs, 'parameter'), 2); // shared + PageParam (q has none)
});

test('properties: components.schemas counted once; $ref not double-counted', () => {
  const recs = parseOpenApi({
    openapi: '3.0.0',
    paths: { '/u': { get: { responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } } } } },
    components: {
      schemas: {
        User: { type: 'object', properties: { id: { type: 'integer', description: 'the id' }, name: { type: 'string' } } },
      },
    },
  });
  // 2 properties, only once (the $ref in the response is not followed), 1 described.
  assert.strictEqual(count(recs, 'property'), 2);
  assert.strictEqual(described(recs, 'property'), 1);
});

test('inline response object schema properties are counted (not $ref)', () => {
  const recs = parseOpenApi({
    openapi: '3.0.0',
    paths: {
      '/inline': {
        get: {
          responses: { 200: { content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean', description: 'flag' } } } } } } },
        },
      },
    },
  });
  assert.strictEqual(count(recs, 'property'), 1);
  assert.strictEqual(described(recs, 'property'), 1);
});

test('swagger 2.0 definitions are read as component schemas', () => {
  const recs = parseOpenApi({
    swagger: '2.0',
    paths: { '/p': { get: { summary: 'x' } } },
    definitions: { Thing: { properties: { a: { description: 'aa' }, b: {} } } },
  });
  assert.strictEqual(count(recs, 'property'), 2);
  assert.strictEqual(described(recs, 'property'), 1);
});

test('non-spec object yields no records; isOpenApiSpec discriminates', () => {
  assert.deepStrictEqual(parseOpenApi({ foo: 'bar' }), []);
  assert.strictEqual(isOpenApiSpec({ openapi: '3.1.0' }), true);
  assert.strictEqual(isOpenApiSpec({ swagger: '2.0' }), true);
  assert.strictEqual(isOpenApiSpec({ paths: {} }), false);
});

test('unquoted YAML numeric version is recognized (openapi: 3.0 / swagger: 2.0)', () => {
  assert.strictEqual(isOpenApiSpec({ openapi: 3.0 }), true);
  assert.strictEqual(isOpenApiSpec({ swagger: 2.0 }), true);
  const y = parseOpenApiText('swagger: 2.0\npaths:\n  /a:\n    get:\n      summary: s\n', 'api.yaml');
  assert.ok(y, 'numeric-version YAML spec must not be skipped');
  assert.strictEqual(parseOpenApi(y).filter((r) => r.kind === 'operation').length, 1);
});

test('parseOpenApiText: JSON and YAML same data model; junk -> null', () => {
  const json = parseOpenApiText('{"openapi":"3.0.0","paths":{"/a":{"get":{"summary":"s"}}}}', 'openapi.json');
  assert.ok(json && json.openapi === '3.0.0');
  const yamlText = 'openapi: 3.0.0\npaths:\n  /a:\n    get:\n      summary: s\n';
  const y = parseOpenApiText(yamlText, 'openapi.yaml');
  assert.ok(y && y.openapi === '3.0.0');
  assert.deepStrictEqual(parseOpenApi(y).filter((r) => r.kind === 'operation').length, 1);
  assert.strictEqual(parseOpenApiText('not: [valid', 'x.yaml'), null);
  assert.strictEqual(parseOpenApiText('{"no":"spec"}', 'x.json'), null);
});
