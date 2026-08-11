'use strict';

// Which stacks each stack-bound criterion can honestly measure. A stack not
// handled here makes its scanner skip (emit no report), so the composition layer
// records Pending rather than a false green. C4 (observability) and C6 (test
// coverage) are now stack-agnostic and are NOT gated here — they scan every
// stack and let absent evidence score an honest low. Only C2 remains gated.

// C2 documented APIs dispositions:
//   'elixir-ast' — score in-code Elixir schemas (Absinthe + phoenix_swagger, AST
//                  parse via the elixir binary). The existing pilot path.
//   'na'         — ruby: declared N/A (the Ruby pilot's existing state; kept unchanged
//                  for parity — an apipie-emitted artifact re-score is a separate,
//                  deliberate step, not this agnostic slice).
//   'artifact'   — every other stack: recognize a committed API-description
//                  artifact (OpenAPI JSON/YAML or GraphQL SDL) and measure it. If
//                  no artifact is present, emit no report -> honest Pending (an
//                  in-code-only API is "not measured", never a false green).
function documentedApisDisposition(stack) {
  if (stack === 'elixir') return 'elixir-ast';
  if (stack === 'ruby') return 'na';
  return 'artifact';
}

// C1 domain boundaries: whether the tree-sitter code graph is trustworthy enough
// on this stack to grade cycles and module fan-out.
//
//   'ok'         — grade the graph-derived metrics.
//   'unreliable' — measure and report them, but do NOT grade them. The scorer
//                  drops these sub-metrics; if nothing else is scoreable the
//                  criterion is INDETERMINATE (not Pending — we are not promising
//                  to fix the extractor, and not a score we cannot defend).
//
// Measured against ground truth on 2026-07-29, not assumed:
//   elixir — graphify 0.9.28/0.9.29 resolves an `alias` only when the module name
//            is exactly two segments AND the file path is its literal lowercase
//            (Foo.Bar -> foo/bar.ex). Three-plus segments (Foo.Bar.Baz) and
//            snake_case (Foo.TwoWord -> two_word.ex) both silently fail, and
//            real Elixir is overwhelmingly one of those. In one umbrella that
//            produced 4 of 8 real cross-app dependencies, plus one edge pointing
//            the wrong way — a pair reported with zero references while the real
//            dependency in the opposite direction was missed. A cycle needs only
//            one missing edge to disappear, so "zero cycles" is uninformative.
//   js/ts  — 5 of 6 real code dependencies in a TypeScript monorepo; the misses
//            eslint-config/typescript-config, consumed via tsconfig `extends`
//            rather than imports, which a code graph is right to omit.
// Ruby and Python are not separately measured; they keep the default until they
// are, because withholding a grade needs evidence just as much as publishing one.
function boundaryGraphDisposition(stack) {
  return stack === 'elixir' ? 'unreliable' : 'ok';
}

module.exports = { documentedApisDisposition, boundaryGraphDisposition };
