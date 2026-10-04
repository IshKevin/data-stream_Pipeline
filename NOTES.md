# NOTES

**Stretch item chosen: real-time updates (Server-Sent Events).** Operators – and the owning client – see new requests and status changes live, without refreshing.
Not part of the brief, but done for convenience: it is also deployed on a VPS with Coolify (`docker-compose.yml` is the single deployment unit; see README).

## 1. Design

**Data model** (PostgreSQL, Alembic migration `0001`):

```
users ──< requests >── request_status_history   (append-only: from, to, changed_by, changed_at, note)
              └──< assignments >── episodes       UNIQUE(assignments.episode_pk)   UNIQUE(episodes.episode_id)
```

`status` lives on `requests` (cheap to filter) *and* every change is an immutable history row – so the audit trail and the "submitted → delivered" analytics come from the same table. Enums are `CHECK`-constrained strings (easier to migrate than Postgres enums).
**Where state lives:** only PostgreSQL. The JWT is stateless but the user row is re-read on every request, so deactivation and role changes apply immediately. The SSE subscriber list is in process memory (ephemeral; clients refetch on reconnect). In the browser TanStack Query is a cache, never a source of truth. The API tells the UI which transitions *this user* may make (`available_transitions`), so workflow rules live in one place (`workflow.py`).

**The hardest decisions**

1. **Rules that must hold under concurrency** ("one episode → one request", "can't deliver without enough episodes"). A check-then-insert in Python is a race, so the *database* is the arbiter (`UNIQUE(episode_pk)` → 409) and every transition/assignment takes `SELECT … FOR UPDATE` on the request row. A test fires two simultaneous assignments of one episode and asserts exactly one wins. Rejected: `SERIALIZABLE` (retry loops everywhere), app-level locks (don't survive several processes).
2. **What the import repairs, rejects, or leaves alone.** Principle: repair what is unambiguous and cosmetic, reject what would change meaning or break a rule, never overwrite existing data, report every decision. Idempotency = `UNIQUE(episode_id)` + `INSERT … ON CONFLICT DO NOTHING`, in one transaction.

   | In `seed/episodes.csv` | Decision |
   |---|---|
   | exact duplicate row | skipped (`duplicate_in_file`) |
   | same id, different data (`EP-00011` bad vs good, `ep-00003` vs `EP-00003`) | **first row wins**, other skipped as `conflicting_duplicate_in_file` – nobody can know which is right, so a human is told |
   | id already in the DB | skipped, **never updated** (an assigned episode must not change quality under a client) |
   | `" arm-01"`, `"  Pick Cup "`, `"Good"`, `ep-00003` | trimmed / case-normalised |
   | `14/08/2026 09:15`, `2026-08-14 09:12:00`, `…Z` | parsed to UTC; slash dates are **day-first**, naive times assumed UTC (assumption documented) |
   | `45.5` s | rounded half-up to 46, reported as `duration_rounded` |
   | missing operator | imported (informational only) |
   | missing/invalid quality (`excellent`), unknown robot (`arm-99`), blank id/robot, `not a date`, `N/A` / negative duration | **rejected** – assignment rules depend on quality; guessing could ship bad data |
   | future date (`2031-01-01`), `999999` s (clips are 8–120 s) | rejected (`date_out_of_range`, `duration_out_of_range`) |
   | 5-of-7-field row, blank lines | skipped (`malformed_row`, `blank_row`) |

   The report returns imported/skipped counts, a reason code + description per reason, what was cleaned up, and the first 1000 skipped rows with line numbers.
3. **Where authorization lives.** Role checks are FastAPI dependencies on every route; *object-level* checks go through one function, `get_request_for_user`, which answers **404, not 403**, so ids can't be probed. Admins are "operator + user management" but may not accept/reject – that step belongs to the client. A policy library felt like over-building for three roles.

**Ambiguities I settled:** assignments are editable while `submitted`/`in_progress` and frozen from `delivered` (rework unlocks them); assigning *more* than requested is allowed (the brief sets a minimum); an episode's task need not match the request's; "median time submitted → delivered" uses the *first* delivery over requests submitted in the range (episodes are filtered by `recorded_at`; bounds inclusive, UTC).

## 2. Left out / simplified – and the next two days

Left out: password change/reset, per-account lock-out (login is only throttled per client IP), refresh tokens / httpOnly cookies, request cancellation, an audit of un-assignments, email notifications. Simplified: the SSE broker is in-process (single API replica); the importer holds the ids it has seen in memory; limit/offset pagination; deployed over plain HTTP (see §4). Tooling gaps I accepted knowingly: TypeScript stays on 6.x (typescript-eslint can't load 7 yet) and there is no `jsx-a11y` lint (no ESLint 10 support yet) – accessibility is checked by role-based component tests and an axe-core audit (0 violations).

Next two days: (1) cookie sessions + CSRF + refresh/revocation, per-account lock-out; (2) Postgres `LISTEN/NOTIFY` for events so the API can scale horizontally; (3) `COPY` + staging-table import; (4) a daily rollup table for analytics; (5) HTTPS on a real domain, managed Postgres backups, metrics (Prometheus).

## 3. Something that went wrong

**The importer was slow.** `generate_episodes.py 200000` took **72 s** (~2.8 k rows/s), and 61 s even when nothing needed inserting. Tests were green, so I profiled 20 k rows with `cProfile` rather than guess: **~40 % of the time was SQLAlchemy compiling statements**, not Postgres or my parsing – I built `insert().values(batch)` with 2 000 literal rows per batch, and every new multi-row `VALUES` is compiled from scratch. One module-level `insert().on_conflict_do_nothing()` executed with a *list* of parameter sets ("insertmanyvalues") compiles once and caches: ~30 s now, ~170 MB peak. The idempotency tests didn't change – that is what they were for.

Three smaller finds, all from looking at the real thing rather than a failing test: (a) `curl -I` on the running SPA showed **none of my security headers** – nginx doesn't inherit server-level `add_header` into a `location` that sets its own; they now live in one included snippet. (b) `Depends(get_db)` on the SSE endpoint keeps a pooled connection for the whole stream – 16 open tabs would starve a pool of 15; the stream now authenticates with a short-lived session. (c) Preparing the Coolify deploy I saw the compose file published the API on host **port 8000 – Coolify's own dashboard port**; host ports are now optional and loopback-only, and CI smoke-tests the stack without fixed ports.

## 4. Security

* **Passwords:** argon2id; only hashes stored. Login verifies a dummy hash for unknown emails and returns one generic message, so neither text nor timing reveals which emails exist.
* **Tokens:** HS256 JWT, 60 min, `exp`/`sub` required, algorithm pinned. The secret (≥ 32 chars, enforced at startup) comes from the environment, never from git.
* **Authorization** is server-side on every route; tests assert 401 on each protected route and walk the whole role matrix. Clients are scoped inside the SQL query.
* **Input validation:** Pydantic limits on every input, `Literal` enums, bound SQL parameters only, size-limited strict-UTF-8 CSV uploads with every cell validated.
* **Web tier:** CSP without inline scripts, `X-Frame-Options`, `nosniff`, Permissions-Policy, COOP/CORP, HSTS (only when the proxy reports HTTPS), `server_tokens off`, nginx `limit_req` on login (~60/min per real client IP, spoofed `X-Forwarded-For` ignored – verified on the deployment), no source maps. API/migrate containers run non-root, read-only filesystem, all capabilities dropped, `no-new-privileges`.
* **Deliberate demo exposure:** the deployed instance keeps the demo accounts from `seed/users.json` (weak, public passwords) so reviewers can sign in, and runs over plain HTTP. Both are demo-only choices; README has the lock-down steps (own admin, deactivate demo users, `SEED_DEMO_DATA=false`, HTTPS).

**The two vulnerabilities I'd worry about most:** (1) **Broken object-level authorization** – "a client sees only their own requests" is enforced by code paths, so a future endpoint that forgets `get_request_for_user` silently leaks data. Mitigated by one choke point, 404-not-403 and per-endpoint tests; next step is Postgres row-level security so a forgotten check fails closed. (2) **Token theft / credential attacks** – the JWT is in `localStorage` (XSS ⇒ a 60-min bearer token, no per-token revocation) and login throttling is per-IP only; next steps are httpOnly+SameSite cookies with CSRF, refresh rotation and per-account lock-out.

## 5. Scale

Measured on a laptop, ≈ 240 k episodes, Postgres 16, no tuning: import of 200 k rows ≈ 30–36 s; re-import of the same file ≈ 29 s with **0 rows created**; `GET /api/analytics` over the whole table 243 ms (planner picks a sequential scan), over one month 57 ms. On the VPS deployment typical API calls take 30–60 ms.

* **10× users** – first to break: the single uvicorn process (40-thread pool, DB pool 5+10) and argon2 CPU on login. Fix: several replicas + PgBouncer – which breaks the in-process SSE broker (an event on replica A never reaches replica B), so move to Postgres `LISTEN/NOTIFY` or Redis.
* **100× episodes** – (a) analytics: windowed queries are index range scans (a test guards the plans), but all-time windows aggregate everything → daily rollup table and/or monthly partitioning by `recorded_at`; (b) import: Python validation + multi-row inserts is fine to ~10⁶ rows, beyond that `COPY` into a staging table with set-based validation; (c) the picker's `COUNT(*)` becomes keyset pagination; (d) autovacuum tuning and a read replica for analytics. At 5 M episodes a month-sized window stays in the hundreds of ms; an all-time one takes seconds.

## 6. AI tooling

I used **Claude Code (Anthropic)** throughout, directed by my prompts: to plan the architecture, scaffold the repo and write the API, the migrations, the React UI, the Docker/Compose/CI configuration, the tests and these notes. I also used it to *verify*: an acceptance script that checks every requirement of the brief against the running system (including recomputing the analytics in independent SQL), Playwright browser runs, an axe-core accessibility audit and a responsiveness check; the problems in §3 were found that way. Everything is covered by tests I can run with one command (`make test`, `make ci`).
