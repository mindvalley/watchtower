'use strict';

// Pure GraphQL SDL reader for C2 (Documented APIs). Turns a `.graphql`/`.gql`
// schema-definition-language file into GraphQL field-style records
// { type, has_description } — the same shape aggregateRecords consumes — so an SDL
// schema pools with OpenAPI/REST and Absinthe under one coverage measure.
//
// Describable surface = fields (of object/interface types), input fields, and enum
// values; each is "described" when an SDL description string (""" block """ or
// "single line") immediately precedes it. This is a coverage heuristic on the text,
// not a full GraphQL parser (no external dependency); it is approximate by design
// and only runs on committed SDL artifacts. No I/O.

// Type opener — also `extend type/interface/input/enum` (federated/modular schemas
// add fields via `extend`, which must be counted too).
const DEF_OPEN = /^(?:extend\s+)?(type|interface|input|enum)\s+([A-Za-z_][\w]*)/;
// A field/input-field line: `name: Type`, `name(args): Type`, with optional
// directives/defaults after. Excludes lines that are just braces or descriptions.
const FIELD = /^([A-Za-z_][\w]*)\s*(\([^)]*\))?\s*:/;
// A field whose argument list OPENS on this line (may close on a later line):
// `name(` — used to count the field once and skip its multi-line argument body.
const FIELD_MULTILINE_OPEN = /^([A-Za-z_][\w]*)\s*\(/;
// An enum value line: a bare identifier (no colon), inside an enum body.
const ENUM_VALUE = /^([A-Za-z_][\w]*)\s*(@[\w]|$)/;

function parseGraphqlSdl(text) {
  const records = [];
  if (typeof text !== 'string' || !text.trim()) return records;
  const lines = text.split(/\r?\n/);

  let currentType = null; // { name, kind } when inside a type body
  let braceDepth = 0;
  let descPending = false;

  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue; // blank — keep any pending description
    if (trimmed.startsWith('#')) continue; // comment

    // Block description """ ... """ (possibly single-line or multi-line).
    if (trimmed.startsWith('"""')) {
      if (trimmed.slice(3).includes('"""')) {
        // single-line """desc"""
        descPending = true;
        continue;
      }
      // consume until closing """
      i += 1;
      while (i < lines.length && !lines[i].includes('"""')) i += 1;
      descPending = true;
      continue;
    }
    // Single-line string description "desc" alone on its line.
    if (/^"(?:[^"\\]|\\.)*"$/.test(trimmed)) {
      descPending = true;
      continue;
    }

    // Definition opener.
    const open = trimmed.match(DEF_OPEN);
    if (open && !currentType) {
      currentType = { name: open[2], kind: open[1] };
      // type-level description is not counted (we count fields/values); consume it.
      descPending = false;
      if (trimmed.includes('{')) braceDepth = 1;
      // `extend`/single-line `{}` edge cases fall through to brace tracking below.
      continue;
    }

    // Track braces to know when a type body opens/closes.
    if (currentType) {
      if (trimmed === '{' || (trimmed.endsWith('{') && braceDepth === 0)) { braceDepth += 1; descPending = false; continue; }
      if (trimmed.startsWith('}')) { braceDepth -= 1; if (braceDepth <= 0) { currentType = null; braceDepth = 0; } descPending = false; continue; }

      if (braceDepth >= 1) {
        if (currentType.kind === 'enum') {
          const ev = trimmed.match(ENUM_VALUE);
          if (ev) {
            records.push({ type: currentType.name, has_description: descPending });
            descPending = false;
            continue;
          }
        } else {
          // A field whose argument list opens here but does not close (`): ` absent)
          // spans multiple lines — count the field once, then skip its argument
          // lines so `term: String` inside the parens is not miscounted as a field.
          if (FIELD_MULTILINE_OPEN.test(trimmed) && !/\)\s*:/.test(trimmed)) {
            records.push({ type: currentType.name, has_description: descPending });
            descPending = false;
            while (i < lines.length && !lines[i].includes(')')) i += 1;
            continue;
          }
          const fld = trimmed.match(FIELD);
          if (fld) {
            records.push({ type: currentType.name, has_description: descPending });
            descPending = false;
            continue;
          }
        }
      }
    }

    // Any other non-blank, non-description line clears a dangling description.
    descPending = false;
  }

  return records;
}

module.exports = { parseGraphqlSdl };
