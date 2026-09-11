# Notes for an AI agent setting this up

You are probably here because someone pointed you at this repository and asked
you to get it working for them. Assume they are not a developer. Do the work,
explain what you are doing in plain words, and ask before anything that costs
them money, touches a private repository, or installs software.

Everything below was verified by running it. Where a value or a version is
given, use it exactly — several of them are not guessable.

## What this is

Two halves. The **scanner** reads a codebase and scores it out of 100 against
seven criteria. The **board** (`dashboard/`) is a web page showing those scores
for one or more codebases. They are independent: the scanner writes JSON files,
the board reads them.

Nothing is compiled or executed. Every scanner reads source only.

## First, ask two questions

**1. What do they want?**

| They want | Do this |
|---|---|
| A score for one codebase, once | Local path, below. Stop after step 4. |
| A board they can look at | Local path, all steps. |
| Scores updated automatically, for a team | Remote path, below. |
| Just to see what the board looks like | The demo board in [the guide](guides/getting-started.md#want-to-see-the-board-before-you-scan-anything). Two minutes, no scanners needed. |

**2. What language is the codebase?** You need this for `stack`, and you cannot
guess it from the folder name. If they do not know, look: `mix.exs` means
elixir, `Gemfile` means ruby, `package.json` means ts or js, `pyproject.toml` or
`requirements.txt` means python.

## Local path

Read [`guides/getting-started.md`](guides/getting-started.md) and follow it. It
is the same steps in more detail. The essentials:

1. **Node 22+.** Check with `node -v`. If it is older, stop and help them
   install it — nothing below will work.
2. **Five scanners.** Use a virtual environment; see the guide. Do not use
   `pip install --user`, which modern Python refuses.
3. **A config file** naming what to scan.
4. **Seven scan commands**, then one assemble command.
5. **The board**, which needs Docker.

## Remote path

They want scans to run by themselves and post to a board someone hosts. That is
a GitHub Actions workflow in a repository they control:

```yaml
- uses: mindvalley/watchtower@v1
  id: engine
- run: node "${{ steps.engine.outputs.engine-path }}/scripts/benchmark/scan-security.js"
  env:
    SYSTEM: their-service
    WATCHTOWER_CONFIG: watchtower.config.json
    WATCHTOWER_REPORTS: reports
```

The action installs every scanner, at the pinned versions, and installs a
language toolchain only when the configuration declares that language. Nothing
in the local setup applies.

Publishing to a hosted board needs credentials that only whoever runs the board
can issue. If they do not have them, the scan still works — it writes the scores
as files and uploads them as build artifacts. Say so rather than leaving them
stuck on the last step.

## Values you must not guess

**`stack`** is one of exactly: `elixir`, `ruby`, `ts`, `js`, `python`.
Not `typescript`, not `node`, not `javascript`. A wrong value fails the
observability scan with `no observability signal set for stack '...'`.

**A system declares `repo` or `path`, never both.** `repo` is `owner/name` and
gets cloned; `path` is a folder on this machine.

**`path` is relative to the config file, not to where you run the command.** A
relative path that looks right from the terminal can point somewhere else
entirely. Use an absolute path if there is any doubt.

```json
{
  "systems": {
    "their-app": { "path": "/Users/them/code/their-app", "stack": "ts" }
  }
}
```

**Scanner versions** are in `scripts/benchmark/scanner-pins.json`. They are part
of the measurement — a different version is a different ruler — so pin them.

**Elixir and Ruby need a toolchain the others do not**: `mix` for Elixir,
`rubocop` for Ruby. Only for those two stacks, and only when running locally.

## When something fails

| What they see | What it means | What to do |
|---|---|---|
| `no observability signal set for stack 'typescript'` | `stack` is not one of the five | Change it to `ts` |
| `externally-managed-environment` from pip | Modern Python refuses `--user` installs | Use a virtual environment |
| `semgrep produced no report` (or gitleaks, trivy) | That scanner is not installed | Install it, at the pinned version |
| `A scan that did not run is not a system with nothing wrong with it` | Assemble found a missing report | A scan failed earlier. Find which, read its output, fix that. **Do not delete the criterion to get past this.** |
| `no material language found` | The target is under 500 lines of any one language | Not an error. Scan something real, or accept that complexity is not measured |
| Boundaries reports `indeterminate` | The codebase has no module structure the graph recognises | Correct behaviour. That criterion has no score; the rest still do |
| `target path for this system does not exist` | `path` is resolved against the config file, not the terminal | Use an absolute path |
| `Cannot find module` after `git clone` | Dependencies not installed | `npm ci` in the repository root, and again in `dashboard/` |

## Things to tell them, unprompted

- **A low score is not a bug.** Most codebases score in the twenties on the
  first run. A red ring means a security finding capped it, which is usually one
  committed secret.
- **Findings can be marked acceptable** when they are false positives, and the
  score changes when they are. See [`guides/allowances.md`](guides/allowances.md).
- **One scan is a position, not a trend.** The board can only show movement once
  there are two.

## Do not

- **Do not change a scanner version to make something pass.** It changes every
  score, and scores from two versions are not comparable.
- **Do not edit anything under `dashboard/` to fix a problem** if this repository
  is being consumed as a subtree elsewhere — the change is overwritten on the
  next release.
- **Do not invent a `stack` value** to get past an error. Ask instead.
- **Do not report success from a run you did not read.** Every scan prints what
  it did; a scan that skipped everything exits zero.

## Where the detail is

| File | Covers |
|---|---|
| [`guides/getting-started.md`](guides/getting-started.md) | Clone to a board, step by step |
| [`README.md`](README.md) | What each criterion measures, how it is scored |
| [`dashboard/README.md`](dashboard/README.md) | The board alone: settings, hosting, adding a page |
| [`guides/allowances.md`](guides/allowances.md) | Marking a finding as judged and acceptable |
