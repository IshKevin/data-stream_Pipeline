# Data stream Pipeline

[![CI](https://github.com/IshKevin/data-stream_Pipeline/actions/workflows/ci.yml/badge.svg)](https://github.com/IshKevin/data-stream_Pipeline/actions/workflows/ci.yml)

Internal platform for managing **robot-teleoperation dataset requests**. Clients request episodes, operators assign them and move
each request through a controlled workflow, and the client accepts or rejects the delivery. Every status change is recorded
(who, when, why), and episode metadata is imported from a messy CSV export safely and repeatably.

* **Role-based access** (client · operator · admin) enforced on the server
* **Workflow engine** with audited transitions and database-enforced assignment rules
* **Idempotent CSV import** with a detailed report of what was imported, cleaned up, and skipped (and why)
* **Analytics computed in PostgreSQL**: episodes per day per robot, fulfilment and median delivery time, top tasks
* **Live updates** over Server-Sent Events
* **One-command start** with Docker Compose; CI; JSON logs and health endpoints

| | |
|---|---|
| **Live demo** | <http://vkuc6nzbv6xn6p97uscuiceb.197.243.27.200.sslip.io/> (plain HTTP; demo accounts listed [below](#demo-accounts)) |
| **Run locally** | `cp .env.example .env && docker compose up --build` → <http://localhost:8080> |
| **Tests** | `make test` (195 API tests in Docker) · `make ci` (everything CI runs, including 27 web tests) |
| **Design notes** | [NOTES.md](NOTES.md) |

## Contents

1. [What it does](#what-it-does)
2. [Walkthrough](#walkthrough)
3. [Requirements traceability](#requirements-traceability)
4. [Code map](#code-map) · [Design decisions](#design-decisions) · [Known limitations](#known-limitations) · [Verification](#verification)
5. [Architecture and tech stack](#architecture-and-tech-stack)
6. [Quick start (local)](#quick-start-local) · [Demo accounts](#demo-accounts)
7. [Configuration](#configuration)
8. [Testing](#testing)
9. [Development](#development)
10. [API reference](#api-reference)
11. [Security and production checklist](#security-and-production-checklist)
12. [Deploy on a VPS with Coolify](#deploy-on-a-vps-with-coolify)
13. [Troubleshooting](#troubleshooting)

---

## What it does

### Roles

| Role | Can do |
|---|---|
| **client** | create requests · see *only their own* requests · accept or reject a delivered request |
| **operator** | see all requests · move a request through its workflow · assign episodes · import episode metadata · analytics |
| **admin** | everything an operator can do, plus create / deactivate users and change roles |

Authentication is required everywhere except login, and **authorization is enforced on the server** (the UI merely reflects it).

### Workflow

```
submitted ──operator──▶ in_progress ──operator──▶ delivered ──client──▶ accepted
                            ▲                        │
                            └──────operator──── rejected ◀──client──────┘   (rework)
```

* Only valid transitions are allowed, and only by the role that owns the step. Every move is stored in
  `request_status_history` (from, to, who, when, optional note – e.g. a rejection reason).
* **Assignment rules:** an episode belongs to at most one request at a time (enforced by a database constraint) · only
  `good` / `usable` episodes can be assigned · a request cannot be delivered until at least `episodes_requested` are assigned.

### Episode import

`POST /api/episodes/import` (UI: **Import**) or `python -m app.cli import-episodes <file>`. The recording-system export is
messy (duplicates, blanks, odd formatting, an unknown robot, a malformed row); the importer repairs what is unambiguous,
rejects what is not, never overwrites existing episodes, and is **idempotent** (`UNIQUE(episode_id)` + `INSERT … ON CONFLICT DO NOTHING`
in one transaction). The report lists imported / skipped counts, a reason code per reason, what was cleaned up, and the first
1000 skipped rows with line numbers. The rules are tabulated in [NOTES.md §1](NOTES.md).

### Analytics (`GET /api/analytics?from=&to=`)

Computed entirely in PostgreSQL for a date range: episodes recorded **per day per robot**, **request counts by status** and the
**median time from submitted to delivered**, and the **top 5 tasks by good episodes**. Each query is served by an index on
`episodes.recorded_at` (a test guards the plans). At 5 million episodes a month-sized window stays in the hundreds of
milliseconds (index range scan + hash aggregate); an all-time window aggregates everything (seconds) – the next step would be a
daily rollup table and/or monthly partitioning (see [NOTES.md §5](NOTES.md) for measurements).

### The UI

React single-page app: login · my requests / all requests (status chips, search, pagination) · new request · request detail with a
workflow stepper, history, assigned episodes and (for operators) an **episode picker** filtered by task and quality · analytics
with charts · CSV import with a drag-and-drop zone and a full report · user administration · live updates · 404 and error screens.
A single light theme, inline-SVG icons, responsive from 320 px phones (tables become labelled cards) to wide desktops,
keyboard-accessible dialogs, toasts in a live region, skip link, `prefers-reduced-motion` respected. Audited with axe-core:
0 WCAG 2.1 A/AA violations.

---

## Walkthrough

An end-to-end tour of the system (about 10 minutes). Use two browser windows – one private – to observe the live updates: **window A = client**, **window B = operator**. Accounts are listed under [Demo accounts](#demo-accounts).

| # | Action | Expected result | Area |
|---|---|---|---|
| 1 | Sign in as `client-a`, then `ops1`, then `admin` | the menu differs per role (client: *Requests*; operator: + *Analytics*, *Import*; admin: + *Users*) | roles |
| 2 | **A:** New request → "pick cup", 2 episodes, a future deadline | status **Submitted**, a workflow stepper, a history entry | requests |
| 3 | **B** (open on *Requests*) | the new request **appears without refreshing**; the top bar shows **Live** | real-time |
| 4 | Sign in as `client-b` and open that request's URL | "Request not found" – clients never see each other's data (API: 404, not 403) | isolation |
| 5 | **B:** open it → **Start work**; look at **Mark delivered** | disabled – "Assign 2 more episode(s) before delivering"; **A** updates live | delivery rule |
| 6 | **B:** in the picker set *Quality = Bad* → tick boxes | disabled (bad episodes can't be assigned). Assign 1 good + 1 usable | assignment rules |
| 7 | **B:** **Mark delivered**; **A:** **Reject delivery** with a reason; **B:** **Start work** → **Mark delivered**; **A:** **Accept delivery** | the full reject → rework → accept loop; **History** shows *who* and *when* for every step, plus the reason | workflow + audit |
| 8 | **B:** *Import* → upload `seed/episodes.csv` (the file loaded at startup) | **0 imported, 191 skipped** with reason codes and line numbers – the import is idempotent; every skip is explained | import |
| 9 | **B:** *Analytics* | episodes per day per robot · requests by status + median submitted→delivered · top-5 tasks by good episodes | analytics |
| 10 | **admin:** *Users* → add a user, change their role, deactivate them | a deactivated user is locked out immediately, even with an existing session | administration |
| 11 | `GET /health` · `GET /ready` · `docker compose logs api` | JSON status; **one JSON log line per request** with method, path, status, duration, user id | operations |

## Requirements traceability

| Requirement | Implementation | Verification |
|---|---|---|
| server-side roles & authorization | `api/app/deps.py` (`require_*`), `services/requests.py::get_request_for_user` | `tests/test_authorization.py` – 401 on every protected route, full role matrix, client isolation |
| import: messy CSV, idempotent, clear report | `api/app/services/importer.py`, `POST /api/episodes/import`, `python -m app.cli import-episodes` | `tests/test_import.py` – twice-in-a-row, batch boundaries, never overwrites, every reason, the real seed file |
| workflow, who/when recorded | `api/app/workflow.py`, table `request_status_history` | `tests/test_transitions.py` – every from × to × role |
| assignment rules | `services/requests.py`, `UNIQUE(assignments.episode_pk)` | `tests/test_assignments.py` incl. a concurrent double-assign race |
| REST API, relational DB, migrations | FastAPI + PostgreSQL + Alembic (`api/alembic/versions/0001_*.py`) | migration up/down + "models match migrations" test |
| analytics in the database | `api/app/routers/analytics.py` | `tests/test_analytics.py` (exact numbers; index-usage guard); scaling behaviour in [Analytics](#analytics-get-apianalyticsfromto) and NOTES §5 |
| `/health` + structured logging | `api/app/main.py`, `logging_config.py` | `tests/test_ops.py` |
| UI: client + operator flows | `web/src/` (React + TypeScript) | 27 web tests · `web/e2e/smoke.mjs` (17-step browser flow) |
| one command starts everything | `docker-compose.yml` (db → migrate/seed → api → web) | CI `stack` job builds it the way a server runs it |
| tests with one command · CI | `make test` / `make ci` · `.github/workflows/ci.yml` | api · web · full-stack jobs |
| design notes (design, trade-offs, incidents, security, scale, AI tooling) | [NOTES.md](NOTES.md) | – |
| commit history | `git log --oneline` | small, conventional commits |

## Code map

Suggested reading order: `api/app/workflow.py` (the whole transition table, no I/O) → `api/app/services/requests.py` (transactions, locking, assignment rules) →
`api/app/services/importer.py` (what is repaired / rejected) → `api/app/routers/analytics.py` (the three SQL reports) →
`api/app/deps.py` (auth) → `api/tests/` → `web/src/pages/RequestDetail.tsx`.

## Design decisions

Summary; the full reasoning is in [NOTES.md](NOTES.md).

* **The database is the arbiter** of "one episode → one request" (`UNIQUE` constraint) and a row lock serialises delivery vs assignment – tested with a race.
* **Import policy:** repair the unambiguous and cosmetic, reject what changes meaning (e.g. missing quality), *first row wins* on conflicting duplicates, never update existing rows.
* **404 instead of 403** for other clients' requests, so ids can't be probed; admins can't accept/reject – that step belongs to the client.
* **"Median submitted → delivered"** uses the *first* delivery of a request (reworked requests count once).
* **Real-time via SSE**, in-process: simple and correct for one replica; `LISTEN/NOTIFY` is the documented next step.

## Known limitations

* The live demo runs over **plain HTTP** with the **public demo accounts** – a deliberate choice for evaluation; the lock-down steps are in the [production checklist](#security-and-production-checklist).
* Login is throttled **per client IP** only (no per-account lock-out); the JWT lives in `localStorage` (XSS ⇒ a 60-minute token) – see NOTES §4 for the two highest-risk vulnerabilities.
* SSE broker is in-process (single API replica); analytics for an *all-time* window on millions of rows would want a rollup table.
* TypeScript stays on 6.x and there is no `jsx-a11y` lint because those tools don't support the newest versions yet – accessibility is covered by role-based tests and an axe-core audit instead.

## Verification

195 API tests and 27 web tests (green in CI) · a 17-step real-browser run of the whole flow, also against the live deployment · axe-core audit of every
page (0 WCAG 2.1 A/AA violations) · a responsiveness check at 7 screen sizes (320 → 1536 px) · an end-to-end acceptance run of 70 checks against the running
stack, which recomputed the analytics with independent SQL · the Compose stack started from a clean clone, with and without fixed host ports ·
login rate limiting and security headers checked on the deployment.

---

## Architecture and tech stack

```
 browser ──▶ web (nginx: React build, gzip, security headers, login rate limit)
               └── /api/*, /health, /ready ──▶ api (FastAPI) ──▶ db (PostgreSQL 18)
 docker compose up:  db ─healthy─▶ migrate (alembic upgrade + optional demo seed, exits 0) ─▶ api ─healthy─▶ web
```

| Layer | Technology |
|---|---|
| API | Python 3.14 · FastAPI · SQLAlchemy 2.1 · Alembic · Pydantic 2 · PyJWT · argon2 · uv |
| Database | PostgreSQL 18 (CHECK and UNIQUE constraints, partial + composite indexes, `percentile_cont`) |
| Web | React 19 · TypeScript 6 · Vite 8 · React Router 7 · TanStack Query 5 |
| Serving | nginx 1.30 (static files + API/SSE proxy) |
| Quality | ruff · mypy · pytest 9 · Vitest + Testing Library · Playwright + axe-core (optional scripts) |
| Ops | Docker Compose v2 · GitHub Actions · Coolify deployment · JSON logs · `/health` + `/ready` |

Exact versions are pinned in `api/uv.lock` and `web/package-lock.json`. (TypeScript 7 exists but `typescript-eslint`
cannot load it yet, so the web app stays on the newest 6.x.)

```
api/     app/ (routers · services · models · workflow rules)  alembic/ (migrations)  tests/  Dockerfile  bootstrap.sh
web/     src/ (pages · components · lib)  e2e/ (browser scripts)  nginx.conf  Dockerfile
seed/    the provided sample data: users.json, episodes.csv, generate_episodes.py
docker-compose.yml   Makefile   .env.example   .github/workflows/ci.yml   .pre-commit-config.yaml
```

---

## Quick start (local)

Requirements: **Docker Engine 25+ with the Compose v2 plugin** (`docker compose`, no hyphen). Nothing else.

```bash
cp .env.example .env        # the example values work for a local try-out
docker compose up --build   # or: make up   (detached)
```

That one command starts PostgreSQL, applies the migrations, creates the seed users, imports the sample `episodes.csv`, starts
the API and serves the web app.

| What | Where |
|---|---|
| Web app | <http://localhost:8080> |
| API docs (OpenAPI) | <http://localhost:8000/api/docs> |
| Health / readiness | `GET /health`, `GET /ready` (also proxied through the web port) |

The fixed ports (`WEB_PORT=8080`, `API_PORT=8000`, `DB_PORT=5434` in `.env.example`) are for local development only, bound to
`127.0.0.1`. If one is taken, change it in `.env`. **On a server leave them unset**: Docker then picks free random loopback
ports (`docker compose port web 80`), so nothing can clash. Stop with `make down`; `make reset` also deletes the data.

### Demo accounts

Created from `seed/users.json` by `python -m app.cli seed-users` (passwords are stored as argon2 hashes). **Demo credentials only**
– they exist so the system can be evaluated without setup (the live demo keeps them on purpose so it can be evaluated); set `SEED_DEMO_DATA=false` for anything real.

| Role | Email | Password |
|---|---|---|
| admin | `admin@example.com` | `admin123` |
| operator | `ops1@example.com` / `ops2@example.com` | `ops123` |
| client | `client-a@example.com` (Acme Robotics) | `client123` |
| client | `client-b@example.com` (Beta Labs) | `client123` |

---

## Configuration

Environment variables (see `.env.example`). Secrets live only in `.env` / the platform's settings – never in git.

| Variable | Default | Purpose |
|---|---|---|
| `POSTGRES_PASSWORD` | – (**required** in compose) | database password; any characters (the app builds and escapes the URL) |
| `POSTGRES_USER`, `POSTGRES_DB` | `data-stream_pipeline` | database user / name; blank values fall back to the default |
| `POSTGRES_HOST`, `POSTGRES_PORT` | `localhost`, `5432` (`db` inside compose) | where the API finds PostgreSQL |
| `DATABASE_URL` | built from the `POSTGRES_*` values | explicit SQLAlchemy URL; wins if set |
| `JWT_SECRET` | – (**required**) | ≥ 32 characters, otherwise the API refuses to start (`openssl rand -hex 32`) |
| `JWT_EXPIRE_MINUTES`, `JWT_ALGORITHM` | `60`, `HS256` | token lifetime / algorithm |
| `LOG_LEVEL` | `INFO` | JSON log level |
| `SEED_DEMO_DATA` | `true` | create the demo users and import the sample episodes on start (idempotent) |
| `SEED_USERS_FILE`, `SEED_EPISODES_FILE` | `/seed/users.json`, `/seed/episodes.csv` | seed sources (baked into the image) |
| `DB_WAIT_SECONDS` | `60` | how long `migrate` waits for the database |
| `KNOWN_ROBOTS`, `MAX_EPISODE_DURATION_SECONDS`, `MAX_UPLOAD_MB` | the 5 known robots, `3600`, `50` | import validation limits |
| `WEB_PORT`, `API_PORT`, `DB_PORT` | – (set in `.env.example` for local use) | optional loopback host ports |

---

## Testing

```bash
make test     # the API suite in Docker (a separate "<db>_test" database on the compose Postgres; leaves a running stack alone)
make ci       # everything GitHub CI runs: compose check, ruff, format, mypy, pytest, web lint/typecheck/tests/build
```

Or with local tools (needs a reachable PostgreSQL): `cd api && uv sync && uv run pytest` (Python 3.14 is installed by uv if missing;
the suite creates and migrates its own `<db>_test` database) · `cd web && npm ci && npm test`.

**API suite – 195 tests** (`api/tests/`), concentrated on what matters most:

| File | Covers |
|---|---|
| `test_authorization.py` | 401 on every protected route; the role matrix; clients isolated from each other (404, not 403); deactivated / demoted users lose access immediately; admin-only user management |
| `test_transitions.py` | every (from, to, role) combination against a hand-written spec; audit trail; rework loop; the "enough episodes assigned" guard |
| `test_assignments.py` | good/usable only; one episode → one request (also at DB level and under a concurrent race); all-or-nothing; frozen once delivered |
| `test_import.py` | idempotency (same file twice, across batch boundaries, never overwriting); every rejection reason; the real messy `seed/episodes.csv`; atomicity |
| `test_analytics.py` | exact numbers on a known dataset; median incl. rework; an index-usage guard |
| `test_ops.py` | `/health`, `/ready`, structured access log, request ids, JSON 500s, migrations up/down + "models match migrations", DB-URL building, `wait-db` |

**Web suite – 27 tests** (`web/src/**/*.test.*`): API client error mapping, SSE parser, shared components (dialog, stepper,
toasts, pagination, progress) and the login / request-detail pages – queried by accessible role and label, so they double as
accessibility checks.

**Optional browser scripts** against a running stack (`cd web && npm i --no-save playwright-core axe-core`, plus
`npx playwright-core install chromium`; set `BASE_URL`, and `CHROME_PATH` to reuse an installed Chrome):

| Script | Checks |
|---|---|
| `node e2e/smoke.mjs` | the whole flow in a real browser: client creates → operator assigns/delivers → client rejects → rework → accept, live updates, role redirects, import, analytics |
| `node e2e/a11y.mjs` | axe-core audit (WCAG 2.1 A/AA) of every page – currently 0 violations |
| `node e2e/responsive.mjs` | every page at 7 sizes from 320 px to 1536 px: no sideways scrolling, tap targets ≥ 30 px (`SHOTS=/tmp/shots` saves screenshots) |

**CI** (`.github/workflows/ci.yml`): `api` (ruff, mypy, pytest against a PostgreSQL service) · `web` (lint, typecheck, tests, build) ·
`stack` (builds the real Compose stack the way a server deployment runs it – no fixed host ports – and smoke-tests login and the API
through the web container). Validate workflow syntax locally with `actionlint`; emulate the runner with [`act`](https://github.com/nektos/act).

---

## Development

```bash
make help        # list targets
make up | down | logs | reset
make dev         # rebuild + restart the API whenever api/app changes ("docker compose watch")
make migrate     # re-run migrations + seed (idempotent)
make import FILE=seed/episodes.csv      # CLI import (same code path as the upload endpoint)
make lint | fmt  # ruff + mypy + tsc  /  auto-format the API
make ci          # what CI runs
```

Run the pieces without Docker for the app itself:

```bash
docker compose up -d db                     # only the database (see: docker compose port db 5432)
cd api && uv sync
export POSTGRES_HOST=localhost POSTGRES_PORT=5434 POSTGRES_PASSWORD=change-me JWT_SECRET=$(openssl rand -hex 32)   # same password as in .env
uv run alembic upgrade head && uv run python -m app.cli seed-users --file ../seed/users.json
uv run uvicorn app.main:app --reload
cd ../web && npm ci && VITE_API_PROXY=http://localhost:8000 npm run dev      # http://localhost:5173
```

* **New migration:** `cd api && uv run alembic revision --autogenerate -m "describe change"`; a test fails if the models drift from the migrations.
* **CLI:** `python -m app.cli seed-users [--file PATH]` · `import-episodes PATH` · `wait-db [--timeout S]`.
* **Large import test:** `python3 seed/generate_episodes.py 200000 > /tmp/big.csv`, then import it (twice – the second run creates nothing).
* **Pre-commit:** `.pre-commit-config.yaml` runs ruff and basic file hygiene (`pre-commit install`).
* **Conventions:** conventional commits (`feat`, `fix`, `test`, `build`, `chore`, `docs`), small commits, one concern each.

---

## API reference

All routes are under `/api` (interactive docs at `/api/docs`). Every route except `POST /auth/login` requires `Authorization: Bearer <token>`.

| Route | Who | Notes |
|---|---|---|
| `POST /auth/login`, `GET /auth/me` | anyone / any user | |
| `POST /requests` | client | |
| `GET /requests`, `GET /requests/{id}` | client (own only) · operator/admin (all) | each request lists the transitions *this user* may make |
| `POST /requests/{id}/transition` | per workflow step | body e.g. `{ "to": "rejected", "note": "blurry footage" }` (`note` optional) |
| `POST /requests/{id}/assignments`, `DELETE /requests/{id}/assignments/{episode}` | operator, admin | assignment is all-or-nothing |
| `GET /episodes`, `GET /episodes/facets` | operator, admin | filters: `task_name`, `quality`, `robot_id`, `assigned`; paginated |
| `POST /episodes/import` | operator, admin | multipart CSV upload → import report |
| `GET /analytics?from=&to=` | operator, admin | inclusive UTC dates, default last 30 days |
| `GET/POST/PATCH /users` | admin | admins cannot lock themselves out |
| `GET /events` | any user | Server-Sent Events; clients only receive their own requests' events |
| `GET /health`, `GET /ready` | public | liveness / readiness (database) |

Errors are JSON, e.g. `{"detail": "Cannot deliver: 1 of 2 required episodes are assigned", "code": "conflict"}`; assignment failures also list
`"errors": [{"episode": "EP-00138", "reason": "already_assigned"}]`; validation errors use FastAPI's standard 422 shape.
Logging: **one JSON line per request** to stdout – method, path, status, duration, request id and the authenticated user id.

---

## Security and production checklist

What is built in: argon2 password hashes, short-lived JWTs (secret ≥ 32 chars enforced), the user re-read on every request,
server-side authorization everywhere, strict input validation, parameterised SQL, CSP without inline scripts, `nosniff`,
`X-Frame-Options`, Permissions-Policy, COOP/CORP, HSTS (when behind HTTPS), no source maps, `noindex`, API/migrate containers running
non-root with a read-only filesystem and no capabilities. Details and the two highest-risk vulnerabilities: [NOTES.md §4](NOTES.md).

Before exposing an instance to real users:

| | |
|---|---|
| **Secrets** | long random `POSTGRES_PASSWORD` and `JWT_SECRET` in the platform's environment – never in git |
| **Accounts** | start with `SEED_DEMO_DATA=true`, sign in as `admin@example.com`, **create a dedicated admin account, deactivate the demo accounts**, then set `SEED_DEMO_DATA=false` |
| **TLS** | terminate HTTPS at the reverse proxy; the web container then sends HSTS by itself (only when `X-Forwarded-Proto: https`) |
| **Brute force** | nginx throttles `POST /api/auth/login` to ~60/min per real client address (burst 20) → `429`; spoofed `X-Forwarded-For` is ignored |
| **Health** | point the platform's check at `GET /health` (liveness) or `GET /ready` (database); every container also has a Docker `HEALTHCHECK` |
| **Backups** | data lives in the `pgdata` volume – schedule dumps; a PostgreSQL major upgrade needs dump/restore |
| **Updates** | push → redeploy; migrations run automatically and are idempotent |

---

## Deploy on a VPS with Coolify

<details>
<summary>Click to expand – the Coolify deployment runbook (how the live demo is deployed)</summary>


The whole system is the single `docker-compose.yml` (Compose v2), deployed as one *Docker Compose* resource: `db` → `migrate`
(one-shot) → `api` → `web`. Only `web` needs a domain – the API and database are never public.

**Server:** Docker Engine 25+ (Coolify installs it), **≥ 2 GB RAM** (three images are built per deploy; add swap on 1 GB machines),
~10 GB free disk, and a DNS `A` record for the domain.

1. **Create the resource.** Coolify → *Projects → New Resource → Docker Compose (from a Git repository)* → this repo, branch `main`;
   compose location `/docker-compose.yml`, base directory `/`.
2. **Environment variables** (Coolify UI):

   | Variable | Value | |
   |---|---|---|
   | `POSTGRES_PASSWORD` | long random string | **required** |
   | `JWT_SECRET` | `openssl rand -hex 32` | **required** |
   | `SEED_DEMO_DATA` | `true` for the first start, then `false` | see step 5 |
   | `POSTGRES_USER`, `POSTGRES_DB` | leave blank | optional |
   | `LOG_LEVEL`, `JWT_EXPIRE_MINUTES` | `INFO`, `60` | optional |

   **Do not set `WEB_PORT`, `API_PORT` or `DB_PORT`** – port 8000 is Coolify's own dashboard, and unset ports mean random free loopback
   ports that cannot clash. Untick "Available at build time" for the secrets if the UI offers it.
3. **Domain.** On the **`web`** service set the domain **with the container port**. This deployment uses
   `http://vkuc6nzbv6xn6p97uscuiceb.197.243.27.200.sslip.io:80` (the `:80` is the container port). For TLS use the `https://` form of a real domain and Coolify
   issues the certificate. `api`, `db` and `migrate` get no domain.
4. **Deploy.** Order: `db` healthy → `migrate` (migrations, optional seed, exits 0) → `api` healthy → `web` healthy. Check
   `http://vkuc6nzbv6xn6p97uscuiceb.197.243.27.200.sslip.io/health` → `{"status":"ok"}` and `/ready` → `{"status":"ready"}`.
5. **Lock down** (see the checklist above): create a dedicated admin, deactivate the demo accounts, set `SEED_DEMO_DATA=false`, redeploy.

**Operating it:** push to `main` (enable the Git webhook for auto-deploy) · back up the `pgdata` volume, e.g. daily from cron
`docker exec $(docker ps -qf name=db-) sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | gzip > /backups/pipeline-$(date +%F).sql.gz`
(copy it off the machine) · reclaim disk now and then with `docker builder prune -af && docker image prune -af` or Coolify's automatic cleanup ·
logs: Coolify → Logs → `api` (JSON lines).

</details>

---

## Troubleshooting

<details>
<summary>Click to expand – common problems and fixes</summary>


| Symptom | Cause / fix |
|---|---|
| `KeyError: 'ContainerConfig'` or `'name' does not match any of the regexes` | You are running the legacy `docker-compose` 1.x binary (end-of-life). Use `docker compose` (v2); if v1 already created containers, run `docker compose down -v` once. |
| `service "migrate" didn't complete successfully` | Read the `migrate` container's log (`docker logs <name>`): it prints a one-line `ERROR:` – missing/short `JWT_SECRET`, missing `POSTGRES_PASSWORD`, or `database not reachable … <reason>`. |
| `password authentication failed` after changing `POSTGRES_*` | Those only apply when the database volume is first created. Reset the volume (`docker compose down -v`, data loss) or revert the values. |
| Upgrading from an older checkout (PostgreSQL 16 → 18) | A major version cannot reuse old data files: `docker compose down -v` once for demo data; `pg_dump`/restore for real data. |
| `port is already allocated` | A fixed `WEB_PORT`/`API_PORT`/`DB_PORT` clashes with another app – change it in `.env`, or leave it unset on a server. |
| failure at `npm ci` during the web build | Search the build log for `=== npm ci FAILED ===`: it prints architecture, free disk/memory and npm's error. Low disk → prune; low memory → add swap; network → redeploy (fetches already retry). |
| `502 Bad Gateway` on the domain | The domain must target the `web` service on port **80** (here `http://vkuc6nzbv6xn6p97uscuiceb.197.243.27.200.sslip.io:80`) and `web` must be healthy. |
| `429 Too many attempts` on login | nginx limits login to ~60/min per client address; wait a moment. |
| Signed out unexpectedly | Sessions last 60 minutes; the login page says "Your session has ended". Deactivated users are signed out at once. |

</details>

---

## Project documents

* [NOTES.md](NOTES.md) – design, hardest decisions, what was left out, what went wrong, security, scale, AI tooling
* [seed/README.md](seed/README.md) – the provided sample data and its known problems
