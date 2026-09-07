# Watchtower dashboard

The board. It shows a fleet of systems scored against the agentic compatibility
criteria, where each score came from, and whether it is moving.

Scanning is a separate thing — the scanner runs wherever your builds run and
posts its results here. This is only the part that stores and shows them.

There is no build step. `server.js` serves `public/` as static files and adds a
few routes; the pages are plain HTML with plain script tags.

## Run it on one machine

Needs Node 22 or newer, and Docker for the database.

```sh
docker compose -f docker-compose.example.yml up -d
npm install
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres
npm run migrate
npm start
```

`http://localhost:8080` — an empty board, because you have not scanned anything
yet.

Already using 5432? Pick another port and use it in both places:

```sh
export WATCHTOWER_DB_PORT=5433
docker compose -f docker-compose.example.yml up -d
export DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres
```

To see what a populated board looks like:

```sh
npm run migrate:mock
```

That loads three invented systems and four weeks of invented history, and the
board says so across the top. It refuses to run against a database that already
holds systems, because mock scores sitting beside real ones are
indistinguishable from measurements.

## Loading a scan you ran yourself

A scan whose configuration names no publishing destination writes its results
out as files and posts nowhere — the right behaviour on a laptop, and what you
get by default. `npm run load` is the other end of that:

```sh
npm run load -- path/to/data
npm run load -- path/to/data --config path/to/watchtower.config.json
```

The directory is the one the scan wrote: `benchmark.json`, and a
`findings-<system>.json` beside it for each system.

`--config` is optional and points at the watchtower configuration, so the board
can record each system's repository and stack. Without it those are blank —
`POST /ingest` takes them from its allowlist, and there is no allowlist when you
are standing at the machine.

`--system <key>` loads a subset and can be repeated. `--dry-run` validates and
prints what would be written.

**This is not a second way into the database.** It builds the payload `/ingest`
receives, runs it through the same validation and the same transform, and calls
the same write — everything except the authentication. A loaded board and a
published board are the same board; otherwise moving a system from one to the
other would change its numbers for reasons unrelated to its code.

Two consequences worth knowing. A directory goes in whole or not at all: if any
system in it would be refused, nothing is written, because eight loaded and
three not is a state you cannot see from the board. And running it twice is
safe — each system is fully replaced, exactly as a publish replaces it, while
`scan_history` gains one entry per run, which is what lets the board show
movement.

## Run it split up

Same thing without the container: bring a Postgres, point `DATABASE_URL` at it,
run the migrations, and run the web server behind whatever hosts it. Scans
happen elsewhere and post their results in.

The service applies pending migrations before it listens. That is deliberate —
a managed database is often reachable only from the running service, so there
is nowhere else to run them from. If your host gives you a release step, set
`WATCHTOWER_MIGRATE_ON_BOOT=false` and run `npm run migrate` there instead.

## Settings

All optional, all read from the environment. Every JSON one accepts either the
document inline or a path to a file, because a secret manager hands you a
string and a mounted volume hands you a file.

| | |
|---|---|
| `DATABASE_URL` | Postgres connection string. Required. |
| `PORT` | Default 8080. |
| `WATCHTOWER_INGEST_AUDIENCE` | The OIDC audience your scanners send. |
| `WATCHTOWER_INGEST_ALLOWLIST` | Which repository may publish which systems. |
| `WATCHTOWER_DISPLAY_NAMES` | Display casing for organisations and systems. |
| `WATCHTOWER_HISTORY_START` | Ignore readings before this date. Empty shows everything. |
| `WATCHTOWER_MIGRATE_ON_BOOT` | `false` to apply migrations yourself. |

**`POST /ingest` is off until both `WATCHTOWER_INGEST_AUDIENCE` and
`WATCHTOWER_INGEST_ALLOWLIST` are set.** It returns 503 saying which one is
missing. An installation nobody has told who may write to it should not be
accepting authenticated writes, and a half-configured one should say so rather
than reject every publish with a 401 that names no cause.

The allowlist maps a publishing repository to the systems it may write:

```json
{
  "your-org/watchtower": [
    { "system_key": "alpha", "repo": "your-org/alpha", "stack": "elixir", "sast_tool": "semgrep" }
  ]
}
```

A caller can never write outside its own set. Identity — repo, stack, tool — is
taken from the entry here and never from the request body.

Display names are casing only, and the board works without them:

```json
{
  "orgs":    { "your-org": "Your Org" },
  "systems": { "alpha": "Alpha", "bravo-api": "Bravo API" }
}
```

Without this file the pages title-case the keys.

## Tests

```sh
npm test
```

Runs without a database, skipping the integration tests. With `DATABASE_URL`
set they run too, each in its own Postgres schema.

## Adding a system

Nothing here. Publish a scan for it and it appears — one page template serves
every system and the database decides which names exist.

## Adding a page

Drop an HTML file in `public/`. It is served at `/<name>` without the extension,
and at its full path by the static handler. Nothing to register.
