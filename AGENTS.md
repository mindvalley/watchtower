# Repository Guidelines

Watchtower scores a codebase against the Agentic Compatibility Benchmark — seven
criteria, one number out of 100. Two independent halves: the **scanner** (this
root, also a composite action) writes JSON; the **dashboard** (`dashboard/`)
stores and shows it. Nothing is compiled or executed — every scanner reads source.

## Two Configurations

Establish which one before anything else. Most of what follows applies to one
and not the other.

**Local** — everything on one machine. You install the scanners, run them
against a folder or a cloned repo, and get `benchmark.json`. Optionally run the
dashboard beside it in Docker and load the files in. Nothing publishes anywhere;
this is the default and needs no credentials. Right for one codebase, for trying
it out, and for a developer who wants their own score.

**Remote** — the scanner runs in CI as the composite action, in each repository
you want scored. It installs its own scanners, so nothing is installed by hand.
Results either stay as build artifacts, or post to a dashboard someone hosts by
declaring `"publish": "ingest"`. Right for a fleet that should stay current
without anyone remembering.

The hosted dashboard is one deployment that many scanners post into. Whoever
runs it must set `WATCHTOWER_INGEST_AUDIENCE` and `WATCHTOWER_INGEST_ALLOWLIST`
or `/ingest` stays off and returns 503; they are the only person who can issue
the credentials a scanner needs to publish. A team can adopt the remote scanner
without a hosted board — the scan still runs and uploads its results.

## Project Structure & Module Organization

- `scripts/benchmark/` — the scanner. `scan-*.js` are the seven I/O edges (one
  per criterion), `score-*.js` and `parse-reports.js` are pure and unit-tested,
  `assemble-scores.js` turns reports into scores.
- `dashboard/` — Express server, Postgres, static pages in `public/`. Its own
  `package.json`, tests and README.
- `guides/` — task documentation. `action.yml` — the composite action.
- `scripts/benchmark/scanner-pins.json` — the pinned scanner versions.

## Routes

| They want | Configuration | Read |
|---|---|---|
| A score for one codebase | Local | [`guides/getting-started.md`](guides/getting-started.md), steps 1–4 |
| A board of their own to look at | Local | the same guide, all steps |
| To see a board before scanning anything | Local, mock data, Docker only | [the demo section](guides/getting-started.md#want-to-see-the-board-before-you-scan-anything) |
| Scans that run themselves, results as artifacts | Remote | [README → Using it](README.md#using-it) |
| Scans posting to a shared board | Remote, plus a host | [README → Where the results go](README.md#where-the-results-go) and [dashboard README → Run it split up](dashboard/README.md#run-it-split-up) |

Ask what language the codebase is before writing a config; you cannot infer it
from the folder. `mix.exs` → elixir, `Gemfile` → ruby, `package.json` → ts or
js, `pyproject.toml` → python.

## Configuration — both

- `stack` is exactly one of `elixir`, `ruby`, `ts`, `js`, `python`. Not
  `typescript`, not `node`. A wrong value fails the observability scan.
- A system declares `repo` **or** `path`, never both.
- **`path` resolves against the config file, not the working directory.** Use an
  absolute path.

## Local only

- Five scanners must be installed, at the versions in `scanner-pins.json`.
  Install them in a virtualenv — `pip install --user` is refused by Homebrew and
  Debian Python (PEP 668).
- `elixir` and `ruby` need a toolchain the others do not: `mix`, `rubocop`.
- The board needs Docker, or any Postgres you point `DATABASE_URL` at.

## Remote only

- The action installs every scanner, and installs a language toolchain only when
  the configuration declares that language. Do not add install steps.
- Publishing needs credentials from whoever hosts the dashboard. Without them
  the scan is not broken — say so rather than leaving someone stuck.
- **If a private repository consumes `dashboard/` with `git subtree`** — which is
  how this project's own deployment works — a fix applied downstream is
  overwritten by the next release. Change it here.

## Diagnosing a Failed Run

| Message | Cause | Fix |
|---|---|---|
| `no observability signal set for stack '…'` | invalid `stack` | use one of the five |
| `externally-managed-environment` | pip refusing `--user` | use a virtualenv |
| `<tool> produced no report` | scanner not installed | install it, pinned |
| `A scan that did not run is not a system with nothing wrong with it` | a report is missing | find the scan that failed; **never delete the criterion** |
| `no material language found` | target under 500 lines of any language | not an error |
| `target path for this system does not exist` | relative `path` | make it absolute |
| boundaries `indeterminate` | no module structure recognised | not an error; that criterion has no score |
| `/ingest` returns 503 | the host has not configured ingest | not the scanner's problem |

## Scoring — NEVER Without Approval

- **NEVER change a version in `scanner-pins.json` to make something pass.** The
  pinned versions are part of the measurement: a different version is a
  different ruler, and scores either side of a bump are not comparable. A bump
  is a scoring change — re-scan everything and compare.
- **NEVER weaken a guard that refuses to score.** A scan that could not run must
  fail loudly; scoring it clean is indistinguishable from a system with nothing
  wrong. This applies to the missing-report check, the missing-tool check, and
  the empty-config check.
- **NEVER report a run as clean without reading its output.** A scan that
  skipped everything exits zero.

## Testing

- `npm test` at the root — the scanner.
- `cd dashboard && npm test` — the board. **Set `DATABASE_URL` or the integration
  tests skip silently**; CI supplies a Postgres service and fails without one.
- Verify a check can fail before trusting it. Several guards here were committed
  passing and could not have failed.

## Commit & Pull Request Guidelines

- Describe the change in plain words in the subject line; no ticket keys.
- Say what was verified and how, not what was intended.
