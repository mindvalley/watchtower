# Watchtower

Two halves of one thing: a **scanner** that scores a repository against the
Agentic Compatibility Benchmark — how safely an AI agent can work in a codebase
— and a **dashboard** that shows the results for a fleet of them.

- The scanner is this repository's root, and a GitHub composite action:
  `uses: mindvalley/watchtower@v1`. Everything below describes it.
- The dashboard is [`dashboard/`](dashboard/), a Node web server you can run on
  one machine with Docker, or behind whatever hosts things for you. It has its
  own README.

You can use either without the other. The scanner writes results; the dashboard
stores and shows them.

## The scanner

**Headless by design.** The engine never compiles, installs, or runs the code it
measures. It reads source, manifests, configuration and git history — on a
shallow clone, or on a copy of a folder on your own machine. That is what lets
it score a repository it knows nothing about.

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

### What a system points at

Each system declares `repo` **or** `path`. Exactly one; both is refused rather
than resolved, because it is two answers to one question.

```jsonc
{
  "systems": {
    "billing": { "repo": "org/billing",  "stack": "elixir" },  // clone from GitHub
    "web":     { "path": "code/web",     "stack": "typescript" }  // a folder here
  }
}
```

A relative `path` is resolved against **the directory holding the config**, not
the working directory, so the same config means the same thing wherever you run
it from. `GH_TOKEN` is only needed for a `repo`.

Local targets are what make a scan usable before you push. Run it on the code in
front of you rather than on whatever is currently on the remote's default
branch.

**A local folder is copied before it is read, never scanned in place.** The scan
writes into the tree it reads — graphify leaves a `graphify-out/` directory — and
nothing here is going to leave build output inside your working copy. What
travels is what git carries: tracked files plus untracked ones no ignore rule
covers, uncommitted edits included. `node_modules`, build directories and
anything else ignored stay behind, which is what keeps a local run comparable to
a CI one. Symlinks are skipped and counted rather than followed.

Change coupling needs a commit log, and the copy has no `.git`; it is read from
the source folder instead, read-only. A folder that is not a git repository is
still scannable — the copy falls back to a fixed list of build directories to
skip, and change coupling reports itself unmeasured rather than clean.

The temp copy is always removed afterwards, and only ever the copy.

### Allowances

See [guides/allowances.md](guides/allowances.md).

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
