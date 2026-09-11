# Getting started

Clone to a board with numbers on it, on one machine, in about fifteen minutes.

Everything here was done on a clean clone before it was written down. Where a
step needs something you probably do not have, it says so rather than assuming.

## What you need

- **Node 20 or newer.** The board asks for 22.
- **Docker**, for the database. Only if you want the board — the scanner writes
  JSON without it.
- **Five scanners**, below. Four of the seven criteria need none of them, but
  you cannot assemble a score without all seven, so a board needs all five.

## 1. Install the scanners

Their versions are part of the measurement: change one and you have changed the
ruler. These are the pinned versions, the same ones the GitHub action installs.

Three come from Python. `pipx` is the tidy way and CI runners have it; a
laptop often does not, so install it first or use `pip` instead.

```sh
# pipx, if you do not have it: brew install pipx  (or python3 -m pip install --user pipx)
pipx install "semgrep==1.78.0"
pipx install "lizard==1.23.0"
pipx install "graphifyy==0.9.28"

# or, without pipx:
python3 -m pip install --user "semgrep==1.78.0" "lizard==1.23.0" "graphifyy==0.9.28"
```

Two are single binaries — release tarballs, or your package manager if it can
pin the version:

```sh
# gitleaks 8.18.4, trivy 0.72.0. Then check what you actually got:
gitleaks version && trivy --version
```

Two more, only if you are scanning that language: **Elixir** with `mix` for a
system declaring `"stack": "elixir"`, and **Ruby** with `rubocop` for `"ruby"`.
Neither is needed otherwise. `jscpd` is fetched on demand and needs no install,
but it does need network during the scan.

## 2. Say what to scan

One file, `watchtower.config.json`, beside where you will run:

```json
{
  "systems": {
    "demo": { "path": "demo", "stack": "ts" }
  }
}
```

A system declares **`repo`** to clone from GitHub, or **`path`** for a folder on
this machine. Exactly one; both is refused.

`stack` must be one of **`elixir`, `ruby`, `ts`, `js`, `python`**. It is the
language of the backend, and it decides which observability and API readers run.

## 3. Scan

Seven scans, one criterion each. Run them from the repository root:

```sh
export SYSTEM=demo
export WATCHTOWER_CONFIG=watchtower.config.json
export WATCHTOWER_REPORTS=reports

node scripts/benchmark/scan-security.js          # secrets, dependency CVEs, static analysis
node scripts/benchmark/scan-simplicity.js        # complexity and duplication
node scripts/benchmark/scan-observability.js     # logging, tracing, error tracking
node scripts/benchmark/scan-deployment.js        # progressive delivery, rollback
node scripts/benchmark/scan-documented-apis.js   # API description coverage
node scripts/benchmark/scan-test-coverage.js     # test breadth and CI enforcement
node scripts/benchmark/scan-boundaries.js        # module graph and change coupling
```

Nothing is compiled or executed. Every scanner reads source.

**Which need an outside tool**, measured rather than assumed:

| Scan | Needs |
|---|---|
| test coverage, observability, deployment, documented APIs | nothing but Node |
| boundaries | graphify |
| simplicity | lizard, and jscpd over the network |
| security | gitleaks, trivy, semgrep |

## 4. Turn the reports into scores

```sh
WATCHTOWER_DATA=data node scripts/benchmark/assemble-scores.js
```

**This refuses to run if any report is missing**, and that is deliberate: a scan
that died writes nothing, and nothing reads as no findings, which is
indistinguishable from a clean result. If it stops here, a scan failed earlier —
go back and read its output rather than deleting the criterion.

You now have `data/benchmark.json` and a findings file per system. That is the
whole scanner. Stop here if you only wanted the numbers.

## 5. Put them on the board

```sh
cd dashboard
npm ci

# A database. The compose file is an example — bring your own if you have one.
WATCHTOWER_DB_PORT=5432 docker compose -f docker-compose.example.yml up -d
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/postgres"

npm run migrate
npm run load -- ../data
npm start
```

Open <http://localhost:3000>.

`npm run load` is the same code path a published scan takes, minus the
authentication. A directory goes in whole or not at all.

## Want to see the board before you scan anything?

```sh
cd dashboard && npm ci
docker compose -f docker-compose.example.yml up -d
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/postgres"
npm run migrate:mock && npm start
```

Mock data is flagged as invented, and the board says so — a board that mixes
real and illustrative numbers is worse than either.

## Running it in CI instead

The scanner is a composite action, so the code and the pinned scanner versions
arrive as one unit and every organisation using the same tag measures with the
same ruler:

```yaml
- uses: mindvalley/watchtower@v1
  id: engine
- run: node "${{ steps.engine.outputs.engine-path }}/scripts/benchmark/scan-security.js"
  env:
    SYSTEM: my-service
    WATCHTOWER_CONFIG: watchtower.config.json
    WATCHTOWER_REPORTS: reports
```

The action installs the scanners for you, and installs a language toolchain only
when your configuration declares that language.

## Where to go next

- [`README.md`](../README.md) — what each criterion measures and how it is scored.
- [`dashboard/README.md`](../dashboard/README.md) — the board on its own: settings, splitting it across hosts, adding a page.
- [`guides/allowances.md`](allowances.md) — marking a finding as judged and acceptable.
