// tests/benchmark/documented-apis-signals.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const {
  isAbsintheModule, isRestApiDoc, isPhoenixSwaggerModule, aggregateRecords, buildReport, aggregateRest,
} = require('../../scripts/benchmark/documented-apis-signals');

test('isAbsintheModule detects Absinthe schema/notation, rejects Ecto', () => {
  assert.strictEqual(isAbsintheModule('use Absinthe.Schema.Notation'), true);
  assert.strictEqual(isAbsintheModule('  use Absinthe.Schema'), true);
  assert.strictEqual(isAbsintheModule('use Ecto.Schema\nfield :name, :string'), false);
  assert.strictEqual(isAbsintheModule(''), false);
  assert.strictEqual(isAbsintheModule(undefined), false);
});

test('aggregateRecords counts totals, described, and per-type breakdown', () => {
  const recs = [
    { type: 'user', field: 'id', has_description: false },
    { type: 'user', field: 'email', has_description: true },
    { type: 'query', field: 'users', has_description: true },
  ];
  const agg = aggregateRecords(recs, 4);
  assert.strictEqual(agg.files_parsed, 4);
  assert.strictEqual(agg.total, 3);
  assert.strictEqual(agg.described, 2);
  const user = agg.by_type.find((t) => t.type === 'user');
  assert.deepStrictEqual(user, { type: 'user', total: 2, described: 1 });
});

test('isRestApiDoc detects OpenAPI/Swagger tooling, else false', () => {
  assert.strictEqual(isRestApiDoc('{:phoenix_swagger, "~> 0.8"}'), true);
  assert.strictEqual(isRestApiDoc('{:open_api_spex, "~> 3.0"}'), true);
  assert.strictEqual(isRestApiDoc('{:absinthe, "~> 1.7"}'), false);
  assert.strictEqual(isRestApiDoc(''), false);
  assert.strictEqual(isRestApiDoc(undefined), false);
});

test('isPhoenixSwaggerModule detects swagger sources, rejects plain modules', () => {
  assert.strictEqual(isPhoenixSwaggerModule('use PhoenixSwagger'), true);
  assert.strictEqual(isPhoenixSwaggerModule('  import PhoenixSwagger'), true);
  assert.strictEqual(isPhoenixSwaggerModule('swagger_path :index do'), true);
  assert.strictEqual(isPhoenixSwaggerModule('swagger_schema do'), true);
  assert.strictEqual(isPhoenixSwaggerModule('use Absinthe.Schema'), false);
  assert.strictEqual(isPhoenixSwaggerModule(''), false);
  assert.strictEqual(isPhoenixSwaggerModule(undefined), false);
});

test('buildReport returns N/A shape when not applicable', () => {
  assert.deepStrictEqual(buildReport({ applicable: false }), { applicable: false, rest_api_detected: false });
});

test('buildReport wraps aggregation when applicable', () => {
  const r = buildReport({ applicable: true, records: [{ type: 'u', field: 'a', has_description: true }], filesParsed: 1 });
  assert.strictEqual(r.applicable, true);
  assert.strictEqual(r.total, 1);
  assert.strictEqual(r.described, 1);
  assert.strictEqual(r.rest_api_detected, false);
});

test('buildReport carries restApiDetected flag', () => {
  const r = buildReport({ applicable: true, records: [], filesParsed: 2, restApiDetected: true });
  assert.strictEqual(r.rest_api_detected, true);
});

test('aggregateRest folds records into totals and by_kind', () => {
  const recs = [
    { kind: 'operation', name: 'update', has_description: true },
    { kind: 'operation', name: 'index', has_description: false },
    { kind: 'parameter', name: 'id', has_description: true },
    { kind: 'property', name: 'name', has_description: false },
  ];
  const agg = aggregateRest(recs, 5);
  assert.strictEqual(agg.files_parsed, 5);
  assert.strictEqual(agg.total, 4);
  assert.strictEqual(agg.described, 2);
  assert.deepStrictEqual(agg.by_kind.operation, { total: 2, described: 1 });
  assert.deepStrictEqual(agg.by_kind.parameter, { total: 1, described: 1 });
  assert.deepStrictEqual(agg.by_kind.property, { total: 1, described: 0 });
});

test('buildReport attaches rest block when restRecords provided', () => {
  const r = buildReport({
    applicable: true, records: [{ type: 'u', field: 'a', has_description: false }], filesParsed: 1,
    restApiDetected: true,
    restRecords: [{ kind: 'operation', name: 'x', has_description: true }], restFilesParsed: 2,
  });
  assert.strictEqual(r.rest_api_detected, true);
  assert.strictEqual(r.total, 1);           // GraphQL untouched
  assert.strictEqual(r.rest.total, 1);
  assert.strictEqual(r.rest.described, 1);
  assert.strictEqual(r.rest.files_parsed, 2);
});

test('buildReport omits rest block when no restRecords', () => {
  const r = buildReport({ applicable: true, records: [], filesParsed: 0 });
  assert.strictEqual(r.rest, undefined);
});
