'use strict';

// Pure helpers for C2 (Documented APIs). No I/O.
//  1. isAbsintheModule: decide which .ex files are Absinthe schema modules, so
//     the scan feeds ONLY those to the AST parser. Ecto schemas use the
//     identical `field` macro and must never be counted (denominator poison).
//  2. aggregateRecords/buildReport: fold the Elixir helper's per-field records
//     into the report the scorer consumes.

const ABSINTHE_USE = /\buse\s+Absinthe\.Schema(?:\.Notation)?\b/;

function isAbsintheModule(source) {
  return ABSINTHE_USE.test(source || '');
}

// A system may expose a documented REST/OpenAPI API instead of (or beside) its
// GraphQL schema. C2 measures only GraphQL description coverage, so scoring the
// GraphQL surface of a REST-primary system misrepresents it. Detect OpenAPI/
// Swagger tooling in a mix.exs so the scorer can defer C2 (Pending) rather than
// publish a misleading GraphQL-only score. (A Swagger-primary Phoenix app is
// the case this exists for.)
const REST_API_MARKER = /\b(phoenix_swagger|open_api_spex)\b/;

function isRestApiDoc(source) {
  return REST_API_MARKER.test(source || '');
}

// A phoenix_swagger source declares swagger operations or schemas. Feed ONLY
// these files to the AST helper (never the whole app). Mirrors isAbsintheModule.
const PHOENIX_SWAGGER = /\b(use|import)\s+PhoenixSwagger\b|\bswagger_path\b|\bswagger_schema\b/;

function isPhoenixSwaggerModule(source) {
  return PHOENIX_SWAGGER.test(source || '');
}

function aggregateRecords(records, filesParsed) {
  const list = Array.isArray(records) ? records : [];
  const byType = new Map();
  let total = 0;
  let described = 0;
  for (const r of list) {
    total += 1;
    const d = r && r.has_description ? 1 : 0;
    described += d;
    const key = (r && r.type) || '(anonymous)';
    const cur = byType.get(key) || { type: key, total: 0, described: 0 };
    cur.total += 1;
    cur.described += d;
    byType.set(key, cur);
  }
  const by_type = [...byType.values()]
    .sort((a, b) => (b.total - a.total) || a.type.localeCompare(b.type));
  return { files_parsed: filesParsed || 0, total, described, by_type };
}

const REST_KINDS = ['operation', 'parameter', 'property'];

function aggregateRest(records, filesParsed) {
  const list = Array.isArray(records) ? records : [];
  const by_kind = { operation: { total: 0, described: 0 }, parameter: { total: 0, described: 0 }, property: { total: 0, described: 0 } };
  let total = 0;
  let described = 0;
  for (const r of list) {
    const kind = r && REST_KINDS.includes(r.kind) ? r.kind : null;
    if (!kind) continue;
    const d = r.has_description ? 1 : 0;
    total += 1;
    described += d;
    by_kind[kind].total += 1;
    by_kind[kind].described += d;
  }
  return { files_parsed: filesParsed || 0, total, described, by_kind };
}

function buildReport({ applicable, records, filesParsed, restApiDetected, restRecords, restFilesParsed }) {
  const rest = !!restApiDetected;
  if (!applicable) return { applicable: false, rest_api_detected: rest };
  const out = { applicable: true, rest_api_detected: rest, ...aggregateRecords(records, filesParsed) };
  if (Array.isArray(restRecords)) out.rest = aggregateRest(restRecords, restFilesParsed);
  return out;
}

module.exports = {
  isAbsintheModule, isRestApiDoc, isPhoenixSwaggerModule, aggregateRecords, buildReport, aggregateRest, ABSINTHE_USE, REST_API_MARKER, PHOENIX_SWAGGER, REST_KINDS,
};
