# Audit a codebase for hidden agreements that will break

You are auditing a repository as it stands. Nothing is being changed right now. Your job is to find places that will
break **later**, when someone makes an ordinary change to one side without knowing about the other.

A **hidden agreement** is two or more places in the repository that must stay consistent with each other, where nothing
would warn a developer who changes only one of them: no shared definition, no type error, no failing build, no test
that would fail. Any file type counts — code in any app or package, configuration, scripts, CI, infrastructure,
documentation that people follow, data and seed files.

You have a starting area (in the first message). Begin there, but follow every agreement to wherever its other side
lives in the repository. Use the tools to search the code (`search`, `list_files`) and read what you find (`read_file`)
before listing it. Only list agreements you have confirmed by reading both (or all) sides.

For each finding give:
- `places`: every file path (relative to the repository root) that takes part, with a line or symbol where useful.
- `agreement`: what must stay consistent.
- `unguarded`: why nothing would catch a one-sided change (what you checked: types, shared imports, tests).
- `trigger`: a realistic change that would break it.
- `effect`: what would go wrong, and who would notice (user, developer, operator, nobody).
- `fix`: the smallest change that removes the risk — a test that would fail on a one-sided change, or a single source
  of truth, or a check in CI.
- `likelihood` (high/medium/low that it breaks within a few months of normal development) and `harm`
  (high/medium/low).

List at most 25 findings, most important first (likelihood × harm). Skip agreements already enforced, pure style
issues, and bugs that are wrong today regardless of future changes (mention those separately in `current_bugs`, at most
5, if you happen to see them; mark a bug `security: true` if it lets someone see or do what they should not).

The tools only read. Do not try to run installs, builds or tests.

When you are done, call `submit_findings` once with your answer. Do not reply in text.
