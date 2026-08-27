# Watchtower Engine

Scans a repository and scores it against the Agentic Compatibility Benchmark —
how safely an AI agent can work in a codebase.

**Headless by design.** The engine never compiles, installs, or runs the code it
measures. It reads source, manifests, configuration and git history on a shallow
clone. That is what lets it score a repository it knows nothing about.

## What it measures

Seven criteria, each scored out of 5 and coloured red / amber / green:

| # | Criterion | Measured by |
|---|---|---|
| 1 | Clear Domain Boundaries | tree-sitter code graph (cycles, fan-out) + change coupling from git history |
| 2 | Documented APIs | description coverage over OpenAPI, GraphQL SDL, and in-code API declarations |
| 4 | Observable State | logging, tracing and error-tracking, scored declared → configured → exercised |
| 6 | Test Coverage | test-to-source breadth + whether CI enforces a coverage floor |
| 7 | Deployment Safety | DORA capabilities visible in the repo: progressive delivery, rollback, pipeline safety, independent deployability |
| 8 | Codebase Simplicity | cyclomatic complexity density + whether a complexity gate is enforced, and duplication |
| 9 | Security Posture | secrets, dependency CVEs, static analysis — each triaged before it is scored |

Numbering is not contiguous: two criteria from the original spec were removed.

## Scoring principles

- **Convention-anchored.** A criterion is scored only against a published
  standard or tool default — McCabe ≤ 10, DORA, Google's coverage tiers. Never
  an arbitrary number. Where this benchmark chose a convention of its own, it
  says so.
- **Never falsely green.** A scanner that cannot run fails the scan; it does not
  report a clean subject. A measurement that cannot be trusted is withheld and
  labelled, not estimated.
- **Language-agnostic first.** Scoring never takes language as an input.
  Language enters only as a lookup for which files are manifests, source, or
  tests. Language-specific parsers raise fidelity; they are never a prerequisite.
- **One number for the system.** Criteria score out of 5; the system composite is
  their mean rescaled to 100, banded red 0–40, amber 41–70, green 71–100 (the
  former 2.0 and 3.5 boundaries, rescaled — no new anchor). A Critical finding
  multiplies the composite by 0.4, so the best a capped system can reach is
  exactly 40, still red. The colour is derived from that number and nothing else,
  so a score can never disagree with the badge beside it. Scaling rather than
  clamping keeps capped systems ordered against each other, which is what says
  which of them is closest to being fixable.

## Using it

The engine ships as a composite action so that the code and the scanner versions
it is calibrated against travel as one unit. A caller one version behind on any
scanner produces numbers that look comparable and are not.

```yaml
- uses: mindvalley/watchtower-engine@v0
  id: engine

- run: node "${{ steps.engine.outputs.engine-path }}/scripts/benchmark/scan-security.js"
  env:
    SYSTEM: my-service
    GH_TOKEN: ${{ steps.token.outputs.token }}
    WATCHTOWER_CONFIG: config/systems.json
    WATCHTOWER_REPORTS: reports
```

### Configuration

The caller says what to measure; the engine says how. Four locations come from
the environment:

| Variable | Holds | Default |
|---|---|---|
| `WATCHTOWER_CONFIG` | the list of systems to scan and where each one lives | `watchtower.config.json` |
| `WATCHTOWER_REPORTS` | where raw scanner output is written | `reports` |
| `WATCHTOWER_DATA` | where assembled scores are read from and written to | `data` |
| `WATCHTOWER_ALLOWANCES` | findings already judged acceptable | `watchtower.allowances.json` |

A missing, malformed, or **empty** system list stops the run. A scan of nothing
reports no findings, which reads exactly like a clean result.

Credentials in the config file are refused outright — it is the one file that
gets committed.

### Allowances

Some findings are not problems: a public site key that reads as a secret, a CVE
in a package only ever loaded in development. Without a way to record that, every
scan re-reports a judgement already made, and the reports stop being read.

An allowance **removes the finding from the score and keeps it in the report**,
marked, with the reason. Nothing disappears — a page can always say "3 findings,
1 allowed".

```json
{
  "allowances": [
    {
      "criterion": "security",
      "sub": "secrets",
      "system": "platform",
      "file": "config/dev.exs",
      "rule": "generic-api-key",
      "reason": "Public reCAPTCHA site key, not a secret",
      "allowed_by": "joshua",
      "allowed_on": "2026-08-19"
    }
  ]
}
```

An entry matches when **every field it names is equal**. Leave a field out and it
broadens — drop `file` and that rule is allowed anywhere; drop `system` and it
applies to every system this watchtower measures. Paths are repo-relative.

Allowances apply to findings that were *found*:

| Criterion | Sub | Match on |
|---|---|---|
| `security` | `secrets` | `file`, `rule` |
| `security` | `deps` | `package`, `id`, `severity`, `bucket`, `target` |
| `security` | `sast` | `id`, `path`, `severity` |
| `simplicity` | `complexity` | `file`, `scope`, `language` |

They do **not** apply to absences — "no rollback configured" is not a false
positive, and allowing it would be accepting a risk, which is a different thing.
Duplication is also excluded: its percentage comes from the duplication tool's own
totals rather than the list of duplicated blocks, so filtering the list would
remove the finding and leave the score where it was.

Every run reports how many findings each allowance absorbed, and names any that
absorbed none — either the finding has been fixed and the entry should go, or it
never matched and has been suppressing nothing since it was written.

Two shapes, one file format. Where the engine repo is also the runner, the file
sits beside the config in that repo. Where the engine is pulled in as a pinned
action, the file lives in the private repo that calls it — the engine carries the
mechanism and nobody's judgements.

## Development

```bash
npm install
npm test
```

The suite runs offline and needs nothing but Node and `js-yaml`. Two tests
exercise Elixir AST helpers and are skipped when Elixir is absent.

## Status

Used in production by Mindvalley across three organisations. Open-sourcing
properly — setup guide, configurable triage filters, dropping the Elixir
prerequisite — is intended but not yet done.
