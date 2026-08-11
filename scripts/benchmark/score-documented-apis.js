'use strict';

// Pure C2 (Documented APIs) scoring. Pooled linear map over public GraphQL fields
// (Absinthe AST) and REST/OpenAPI operations/parameters/response-schema properties
// (phoenix_swagger AST): score = round1(5 * (gqlDescribed+restDescribed)/(gqlTotal+restTotal)).
// Returns null when the criterion does not apply (N/A), when REST is detected but
// produced zero parseable fields (detection failure), or when total is zero (Pending).
// Never a false green.

const { round1, colourFor } = require('./score-security');

const TOP_UNDESCRIBED = 5;
const REST_LIMITATIONS = [
  'Shared parameter macros (e.g. CommonParameters.*) and compile-time param groups are not expanded — parameters they inject are not counted.',
  'Only the `parameters do`/`properties do` block forms are parsed; flat `parameter ...` calls, if any, are not counted.',
];

function facet(described, total) {
  const score = round1(5 * (described / total));
  return { score, colour: colourFor(score), pct: Math.round((described / total) * 100), described, total };
}

function scoreDocumentedApis(report, { assessedAt } = {}) {
  const r = report || {};
  if (!r.applicable) return null;                       // N/A (no machine API)

  const gqlTotal = Number(r.total) || 0;
  const gqlDescribed = Number(r.described) || 0;
  const rest = r.rest || null;
  const restTotal = rest ? Number(rest.total) || 0 : 0;
  const restDescribed = rest ? Number(rest.described) || 0 : 0;

  // REST tooling detected but the parse produced nothing -> detection failure.
  if (r.rest_api_detected && restTotal === 0) return null; // Pending, never false green

  const total = gqlTotal + restTotal;
  const described = gqlDescribed + restDescribed;
  if (total === 0) return null;                          // Pending (detection failure)

  const coverage = described / total;
  const score = round1(5 * coverage);
  const colour = colourFor(score);
  const pct = Math.round(coverage * 100);
  const multi = gqlTotal > 0 && restTotal > 0;

  const sub = {};
  if (gqlTotal > 0) sub.field_description_coverage = facet(gqlDescribed, gqlTotal);
  if (restTotal > 0) sub.rest_description_coverage = { ...facet(restDescribed, restTotal), by_kind: rest.by_kind };

  const findings = [];
  if (restTotal > 0) findings.push(`REST/OpenAPI descriptions: ${sub.rest_description_coverage.pct}% (${restDescribed} of ${restTotal})`);
  if (gqlTotal > 0) findings.push(`GraphQL field descriptions: ${sub.field_description_coverage.pct}% (${gqlDescribed} of ${gqlTotal})`);
  if (multi) findings.push(`Pooled documentation coverage: ${pct}% (${described} of ${total})`);

  const actions = [];
  const restUndesc = restTotal - restDescribed;
  const gqlUndesc = gqlTotal - gqlDescribed;
  if (restUndesc > 0) {
    actions.push(`Add descriptions to REST/OpenAPI (Swagger) operations, parameters, and response-schema properties — ${restUndesc} element${restUndesc === 1 ? '' : 's'} undescribed.`);
  }
  if (gqlUndesc > 0) {
    actions.push(`Add descriptions to public GraphQL fields — an agent reads names and types via introspection but relies on descriptions to use the API correctly. ${gqlUndesc} field${gqlUndesc === 1 ? '' : 's'} undescribed.`);
  }

  const byType = Array.isArray(r.by_type) ? r.by_type : [];
  const topUndescribed = byType
    .map((t) => ({ type: t.type, undescribed: (t.total || 0) - (t.described || 0) }))
    .filter((t) => t.undescribed > 0)
    .sort((a, b) => b.undescribed - a.undescribed)
    .slice(0, TOP_UNDESCRIBED);

  const audit = {
    files_parsed: Number(r.files_parsed) || 0,
    total: gqlTotal,
    described: gqlDescribed,
    top_undescribed_types: topUndescribed,
  };
  if (restTotal > 0) {
    audit.rest = { files_parsed: Number(rest.files_parsed) || 0, total: restTotal, described: restDescribed, by_kind: rest.by_kind };
    audit.pooled = { total, described };
    audit.limitations = REST_LIMITATIONS;
  }

  const source = multi
    ? 'API description coverage — pooled over public GraphQL fields (Absinthe AST) and REST/OpenAPI operations/parameters/response-schema properties (phoenix_swagger AST); anchor 100%'
    : (restTotal > 0
      ? 'API description coverage — REST/OpenAPI operations/parameters/response-schema properties (phoenix_swagger AST); anchor 100%'
      : 'API description coverage — non-empty description on public GraphQL fields (Absinthe schema, AST parse); anchor 100%');

  return { score, colour, critical: false, assessed: true, assessed_at: assessedAt, source, sub, findings, actions, audit };
}

module.exports = { scoreDocumentedApis };
