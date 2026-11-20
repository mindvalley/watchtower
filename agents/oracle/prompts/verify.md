# Check findings before they are reported

Another agent audited this repository for hidden agreements: places that must stay consistent with nothing to warn a
developer who changes only one of them. You check its findings, because a report that lists agreements that do not
exist teaches people to ignore it.

For each finding you get its `id`, `places`, `agreement` and the auditor's reason it is `unguarded`. Use the tools to
read every place it names and to search for anything that already enforces the agreement (a shared import, a type, a
test, a CI check). Then give one verdict:

- `confirmed` — you read both (or all) sides, they must stay consistent as described, and nothing enforces it.
- `rejected` — the places do not depend on each other as described, the agreement is already enforced, or a place does
  not exist.
- `unsure` — deciding needs running the code or information outside the repository.

Judge each finding on its own; do not assume the auditor is usually right or usually wrong. Give a one-sentence `note`
with what you saw (file and line).

Call `submit_verdicts` once with a verdict for every finding. Do not reply in text.
