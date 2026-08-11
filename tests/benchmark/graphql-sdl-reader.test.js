// tests/benchmark/graphql-sdl-reader.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { parseGraphqlSdl } = require('../../scripts/benchmark/graphql-sdl-reader');

const total = (r) => r.length;
const described = (r) => r.filter((x) => x.has_description).length;

test('object fields: block and single-line descriptions counted; undescribed not', () => {
  const sdl = `
"""A user account"""
type User {
  """The unique id"""
  id: ID!
  "the display name"
  name: String
  email: String
}`;
  const r = parseGraphqlSdl(sdl);
  assert.strictEqual(total(r), 3); // id, name, email
  assert.strictEqual(described(r), 2); // id (block), name (single-line); email none
  assert.ok(r.every((x) => x.type === 'User'));
});

test('fields with arguments still count as one describable field', () => {
  const sdl = `
type Query {
  "search things"
  search(term: String!, limit: Int): [String]
  ping: Boolean
}`;
  const r = parseGraphqlSdl(sdl);
  assert.strictEqual(total(r), 2);
  assert.strictEqual(described(r), 1);
});

test('enum values and input fields are counted', () => {
  const sdl = `
enum Role {
  "an admin"
  ADMIN
  MEMBER
}
input Filter {
  "by name"
  name: String
  age: Int
}`;
  const r = parseGraphqlSdl(sdl);
  // Role: ADMIN(desc), MEMBER; Filter: name(desc), age
  assert.strictEqual(total(r), 4);
  assert.strictEqual(described(r), 2);
});

test('description must be adjacent — a plain line clears a dangling description', () => {
  const sdl = `
type T {
  a: Int
  b: Int
}`;
  const r = parseGraphqlSdl(sdl);
  assert.strictEqual(described(r), 0);
});

test('multi-line field arguments: the field is counted once, arg lines are not fields', () => {
  const sdl = `
type Query {
  "search things"
  search(
    term: String!
    limit: Int
  ): [String]
  ping: Boolean
}`;
  const r = parseGraphqlSdl(sdl);
  // Exactly two fields: search (described) + ping (not). term/limit are args, not fields.
  assert.strictEqual(total(r), 2);
  assert.strictEqual(described(r), 1);
  assert.ok(r.every((x) => x.type === 'Query'));
});

test('extend type fields are counted', () => {
  const sdl = `
extend type Query {
  "extra query"
  extra: String
  more: Int
}`;
  const r = parseGraphqlSdl(sdl);
  assert.strictEqual(total(r), 2);
  assert.strictEqual(described(r), 1);
});

test('empty / non-string input yields no records', () => {
  assert.deepStrictEqual(parseGraphqlSdl(''), []);
  assert.deepStrictEqual(parseGraphqlSdl(null), []);
});
