'use strict';

// Pure, format-neutral OpenAPI/Swagger reader for C2 (Documented APIs). Turns a
// parsed spec object (from JSON or YAML — same data model) into the same
// {kind, has_description} REST records the scorer already pools via aggregateRest,
// so an OpenAPI spec is measured apples-to-apples with the five's phoenix_swagger
// surface: operations + parameters + schema properties (a deliberate granularity choice).
//
// No I/O and no network — the caller reads/parses the file. `parseOpenApiText`
// dispatches by serialization (JSON vs YAML); `parseOpenApi` does the counting.

const yaml = require('js-yaml');

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace']);
const MAX_DEPTH = 12;

const nonEmpty = (s) => typeof s === 'string' && s.trim().length > 0;
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// Walk a schema object counting each describable `properties.<p>` as one record.
// Recurses into nested inline objects (properties/items/allOf/anyOf/oneOf) but
// never follows `$ref` — a ref resolves to a named component counted once on its
// own. `depth` guards against pathological nesting.
function collectSchemaProps(schema, records, depth) {
  if (!isObj(schema) || depth > MAX_DEPTH) return;
  if (isObj(schema.properties)) {
    for (const name of Object.keys(schema.properties)) {
      const prop = schema.properties[name];
      records.push({ kind: 'property', name, has_description: isObj(prop) && nonEmpty(prop.description) });
      if (isObj(prop) && !prop.$ref) collectSchemaProps(prop, records, depth + 1);
    }
  }
  if (isObj(schema.items) && !schema.items.$ref) collectSchemaProps(schema.items, records, depth + 1);
  for (const key of ['allOf', 'anyOf', 'oneOf']) {
    if (Array.isArray(schema[key])) {
      for (const sub of schema[key]) if (isObj(sub) && !sub.$ref) collectSchemaProps(sub, records, depth + 1);
    }
  }
}

// Collect inline (non-$ref) object schemas from an operation's requestBody and
// responses content. $ref'd schemas are skipped — counted via components.schemas.
function collectInlineOperationSchemas(op, records) {
  const bodies = [];
  if (isObj(op.requestBody) && isObj(op.requestBody.content)) bodies.push(op.requestBody.content);
  if (isObj(op.responses)) {
    for (const code of Object.keys(op.responses)) {
      const resp = op.responses[code];
      if (isObj(resp) && isObj(resp.content)) bodies.push(resp.content);
    }
  }
  for (const content of bodies) {
    for (const mediaType of Object.keys(content)) {
      const media = content[mediaType];
      if (isObj(media) && isObj(media.schema) && !media.schema.$ref) {
        collectSchemaProps(media.schema, records, 0);
      }
    }
  }
}

// Count parameters on an operation (and shared path-item level). $ref parameters
// resolve to components.parameters for their description.
function collectParams(paramList, componentsParams, records) {
  if (!Array.isArray(paramList)) return;
  for (const p of paramList) {
    let param = p;
    if (isObj(p) && typeof p.$ref === 'string') {
      const m = p.$ref.match(/#\/components\/parameters\/(.+)$/);
      param = (m && componentsParams[m[1]]) || {};
    }
    records.push({ kind: 'parameter', name: isObj(param) ? param.name : undefined, has_description: isObj(param) && nonEmpty(param.description) });
  }
}

// parseOpenApi(specObject) -> records[] of { kind: 'operation'|'parameter'|'property', has_description }.
// Returns [] for a non-spec object (no paths and no components) so the caller can
// treat "recognized file but empty surface" as Pending, never a false green.
function parseOpenApi(spec) {
  if (!isObj(spec)) return [];
  const records = [];
  const components = isObj(spec.components) ? spec.components : {};
  const componentsParams = isObj(components.parameters) ? components.parameters : {};

  const paths = isObj(spec.paths) ? spec.paths : {};
  for (const p of Object.keys(paths)) {
    const item = paths[p];
    if (!isObj(item)) continue;
    // path-item level shared parameters
    collectParams(item.parameters, componentsParams, records);
    for (const method of Object.keys(item)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      const op = item[method];
      if (!isObj(op)) continue;
      records.push({ kind: 'operation', name: `${method.toUpperCase()} ${p}`, has_description: nonEmpty(op.description) || nonEmpty(op.summary) });
      collectParams(op.parameters, componentsParams, records);
      collectInlineOperationSchemas(op, records);
    }
  }

  // Named component schemas — each counted once.
  const schemas = isObj(components.schemas) ? components.schemas : (isObj(spec.definitions) ? spec.definitions : {});
  for (const name of Object.keys(schemas)) {
    collectSchemaProps(schemas[name], records, 0);
  }

  return records;
}

// Does a parsed object look like an OpenAPI/Swagger spec? Accept the version key
// as a string OR a number — unquoted YAML (`openapi: 3.0`, `swagger: 2.0`) loads
// as a JS number, and rejecting it would silently skip the whole spec.
function isOpenApiSpec(obj) {
  if (!isObj(obj)) return false;
  const v = obj.openapi !== undefined ? obj.openapi : obj.swagger;
  return typeof v === 'string' || typeof v === 'number';
}

// Parse spec text by serialization. Returns null if it doesn't parse or isn't a spec.
function parseOpenApiText(text, filename) {
  let obj;
  try {
    obj = /\.ya?ml$/i.test(filename || '') ? yaml.load(text) : JSON.parse(text);
  } catch {
    return null;
  }
  return isOpenApiSpec(obj) ? obj : null;
}

module.exports = { parseOpenApi, parseOpenApiText, isOpenApiSpec };
