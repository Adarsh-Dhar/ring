# Production Readiness Changes

This document records every code change made to bring the application from
prototype quality to production-grade. Each section names the problem, what
was changed, which files were touched, and how to verify the fix.

---

## Fix 1 — Escalation state: no duplicate alerts on restart

### Problem
`loadStateFromDB()` reset every open case's `deadlineAt` to `now + timeoutSec`
on boot, causing the first helper to be alerted *again* after every restart.
This made the app noisy and confusing in any deployment that restarts (crash,
deploy, OOM kill).

### What changed
`lib/doorbell/store.ts` — `loadStateFromDB()` boot block

- **Before**: `c.deadlineAt = Date.now() + timeout * 1000` (unconditional reset)
- **After**: the saved `deadlineAt` is preserved.
  - If the deadline is still in the future the timer resumes silently.
  - If the deadline already passed while the server was down, a 5-second
    grace window is set so `tick()` can immediately escalate or resolve the
    case — no duplicate push or SMS.
  - A log entry is written in both cases so operators can see that a restart
    occurred.

### Files
- `lib/doorbell/store.ts`

### Verify
Run `npm test` — `tests/escalation.test.ts` covers the timer logic. Manually:
restart the server while a case is open and confirm the helper does **not**
receive a second alert.

---

## Fix 2 — Health check: wrong 503 logic + Docker healthcheck typo

### Problem 1 — Wrong 503
`getHealth()` set `ready: states.some(s => s.cases.some(c => c.status === 'waiting'))`.
`/api/health` then returned `503` whenever `ready` was false — i.e., whenever
nobody was at the door. The container was *always* unhealthy when the door was
quiet.

### Problem 2 — Typo in `docker-compose.yml`
The `server` service healthcheck used `http://127.0.1:3000` (missing `.0`),
so `wget` could never connect and Docker always reported the container unhealthy.

### What changed

`lib/doorbell/store.ts` — `getHealth()`
- `ready` is now always `true` (the app is alive; `householdsLoaded` tells you
  how many households are in memory).
- Added `householdsLoaded` counter to the health payload.

`app/api/health/route.ts`
- Removed the `readyOk` gate.
- Health is now `ok` when `tickOk && !anyDeviceOffline`.
- In `DEMO_MODE` the tick-age check is still relaxed to 2 minutes.

`docker-compose.yml`
- `127.0.1` → `127.0.0.1`

### Files
- `lib/doorbell/store.ts`
- `app/api/health/route.ts`
- `docker-compose.yml`

### Verify
`curl http://localhost:3000/api/health` while no case is open must return
`200`. `docker compose ps` must show the server as `healthy` within 40 s.

---

## Fix 3 — Database: replace `db push` with proper migrations

### Problem
`package.json` `db:deploy` ran `prisma db push --skip-generate`, which
compares the live schema with `schema.prisma` and **silently alters or drops
columns**. There was no `prisma/migrations/` folder, so there was no record of
what the schema looked like at any point in time. A bug in `schema.prisma`
could silently destroy live data.

### What changed

`prisma/migrations/0001_initial/migration.sql` (new)
- Full `CREATE TABLE` baseline generated with `prisma migrate diff --from-empty`.

`prisma/migrations/migration_lock.toml` (new)
- Required by Prisma to lock the provider.

`package.json`
- `db:deploy` now runs `prisma migrate deploy` (applies only pending
  migrations, never drops anything not explicitly listed).

`Dockerfile`
- Updated comment on the `CMD` line to reflect `migrate deploy`.

### Files
- `prisma/migrations/0001_initial/migration.sql` (new)
- `prisma/migrations/migration_lock.toml` (new)
- `package.json`
- `Dockerfile`

### Verify
```bash
# Fresh database
docker compose down -v && docker compose up -d
docker compose exec server npx prisma migrate status
# Should show: "All migrations have been applied."
```

---

## Fix 4 — Resident pairing: add IP rate limiting + per-code attempt counter

### Problem
`POST /api/session` (resident device pairing) had:
- No rate limiting at all — an attacker could try all 36^6 ≈ 2.2 billion
  combinations given enough time.
- The in-memory rate limiter in `lib/ratelimit.ts` resets on every restart,
  so any attempt counter was useless in practice.
- No per-code lockout — a single code could be guessed indefinitely.

### What changed

`app/api/session/route.ts`
- Added IP-based rate limit: **5 attempts per IP per 10 minutes** using the
  existing `hit()` function from `lib/ratelimit.ts`.
- Added per-code DB attempt counter: after **10 wrong guesses** the code row
  is permanently locked (`pairingAttempts >= PAIRING_MAX_ATTEMPTS`). The
  guardian must generate a new code.
- On a successful pairing the `pairingAttempts` counter is reset to 0.

`prisma/schema.prisma`
- Added `pairingAttempts Int @default(0)` to `ResidentDevice`.

`prisma/migrations/0001_initial/migration.sql`
- Column added to the `CREATE TABLE "ResidentDevice"` statement so fresh
  installs get it.

`prisma/migrations/0002_pairing_rate_limit/migration.sql` (new)
- `ALTER TABLE "ResidentDevice" ADD COLUMN "pairingAttempts" INTEGER NOT NULL DEFAULT 0`
  for existing databases upgrading from the pre-migration era.

### Files
- `app/api/session/route.ts`
- `prisma/schema.prisma`
- `prisma/migrations/0001_initial/migration.sql`
- `prisma/migrations/0002_pairing_rate_limit/migration.sql` (new)

### Verify
```bash
# Attempt 6 times from the same IP in < 10 minutes
for i in $(seq 1 6); do
  curl -s -X POST http://localhost:3000/api/session \
    -H 'Content-Type: application/json' \
    -d '{"pairingCode":"AAAAAA"}' | jq .error
done
# 6th call should return: "Too many pairing attempts..."
```

---

## Fix 5 — Error tracking: centralised reporter + reduce `any` casts

### Problem
Errors in background paths (the tick timer, device polling, request sweeps,
daily Ring token refresh) were either silently swallowed or printed to stderr
with no structure and no way to route them to an alerting system.

There were also ~50 `: any` casts scattered through the DB layer that hid type
errors from the compiler.

### What changed

`lib/errors.ts` (new)
- `captureError(err, ctx)` — async, logs to stderr and (if `SENTRY_DSN` is set
  and `@sentry/node` is installed) forwards to Sentry.
- `reportError(err, ctx)` — fire-and-forget synchronous wrapper for use inside
  `setInterval` callbacks.
- Lazy Sentry loading: `@sentry/node` is not required. If the package is absent
  the function falls back to `console.error` silently.

`lib/doorbell/store.ts`
- `import { reportError } from '../errors'` added.
- `saveState` catch: `console.error` → `reportError(e, { householdId, fn: 'saveState' })`.
- `tick` sweep catch: `console.error` → `reportError(e, { householdId, fn: 'sweepRequests' })`.
- Global `setInterval` tick: `tick()` → `tick().catch(e => reportError(...))`.
- Daily refresh: silent `.catch(() => {})` → `reportError(e, { householdId, fn: 'forceRefreshConnection' })`.
- `pub` helper: `(m: any)` → typed `MemberRow` interface.

`lib/doorbell/notify.ts`
- `subs.map((s: any)` → `subs.map((s)` with explicit cast on `s.keys`.

`lib/db/push.ts`
- `keys: any` parameter → `keys: { p256dh: string; auth: string }`.
- `memberships.map((m: any)` → `memberships.map((m)`.

`lib/db/cases.ts`
- `import type { Prisma }` added.
- `updateData: any` → `updateData: Prisma.CaseUpdateInput`.
- `data.log as any` → `data.log as Prisma.JsonArray`.
- `data.chain as any` → `data.chain as Prisma.JsonArray`.

`lib/db/visits.ts`
- `import type { Prisma }` added.
- `updateData: any` → `updateData: Prisma.RecurringVisitUpdateInput`.

`.env.example`
- Added `SENTRY_DSN` entry with instructions.

### Files
- `lib/errors.ts` (new)
- `lib/doorbell/store.ts`
- `lib/doorbell/notify.ts`
- `lib/db/push.ts`
- `lib/db/cases.ts`
- `lib/db/visits.ts`
- `.env.example`

### Verify
`npx tsc --noEmit` — zero errors. Set `SENTRY_DSN` + install `@sentry/node`
and check that errors appear in your Sentry project.

---

## Fix 6 — Cleanup: remove scratch files, update `.gitignore`

### Problem
The repo root contained ad-hoc developer artefacts that were accidentally
committed: `_sim_test.mjs`, `_check.sh`, `TEST_RESULTS.md`,
`FINAL_TEST_REPORT.md`. These were not source code and should not ship.
`MIGRATION_GUIDE.md` was useful but misplaced.

### What changed

Deleted from repo root:
- `_sim_test.mjs`
- `_check.sh`
- `TEST_RESULTS.md`
- `FINAL_TEST_REPORT.md`

Moved:
- `MIGRATION_GUIDE.md` → `docs/MIGRATION_GUIDE.md`

`.gitignore` — added patterns:
```
_*.mjs
_*.sh
_*.ts
TEST_RESULTS*.md
FINAL_TEST_REPORT*.md
```

### Files
- `.gitignore`
- `docs/MIGRATION_GUIDE.md` (moved from root)

---

## Fix 7 — Face data: retention enforcement + privacy policy

### Problem
- `FACE_RETENTION_DAYS` was documented and respected for *sightings* (via
  `purgeOldSightings`), but **GuestFace embeddings** belonging to closed
  regular-visitor registrations were never automatically deleted. Once
  enrolled, a face stayed in the database forever unless a guardian manually
  deleted it.
- No privacy policy document existed, which is a legal requirement before
  collecting biometric data under India's DPDP Act 2023 and GDPR.

### What changed

`face/store.ts`
- Added `purgeOldEnrollments(now?)` — deletes `GuestFace` rows whose `ref`
  starts with `reg:` (i.e., created from a regular-visitor registration) and
  whose `createdAt` is older than `FACE_RETENTION_DAYS`. Throttled to run at
  most once per hour.
- Added `_resetEnrollmentPurgeClock()` for tests.

`lib/doorbell/store.ts`
- The existing daily `setInterval` now also calls `purgeOldEnrollments()` via
  dynamic import (so the face module is not loaded if `FACE_ENABLED=0`).

`docs/FACE_DATA_POLICY.md` (new)
- Covers: what data is collected, legal basis and consent requirements,
  how data is used, retention table, data-subject rights (access, correction,
  deletion, withdrawal), security measures, operator obligations under DPDP /
  GDPR, and a configuration reference.

### Files
- `face/store.ts`
- `lib/doorbell/store.ts`
- `docs/FACE_DATA_POLICY.md` (new)

### Verify
```bash
# Set FACE_RETENTION_DAYS=0 in .env to make every embedding "old"
# then trigger the daily timer manually via the store's exported purge fn
# or check the [FACE] purged N old enrollment(s) log line after 24 h.
```

---

## Verification

```
npx tsc --noEmit   # 0 errors
npm test           # 154/154 tests pass, 15 test files
```

The `[ERROR]` line printed during `tests/door-policy.test.ts` is a pre-existing
gap in that test's mock (it does not stub `visitRequest.findMany`). The error
was always there; it was previously swallowed by `console.error`. Now
`reportError` labels it clearly. The test still passes because `sweepRequests`
failures are non-fatal by design.

---

## What still needs doing before a public launch

These items were identified during the audit but are out of scope for this
change set:

1. **Single-process constraint** — the escalation timer still lives in one
   Node.js process. Do not run more than one replica behind a load balancer.
   If you need horizontal scaling, move the timer to a separate worker process
   or use a distributed queue (e.g., BullMQ with Redis).

2. **SMS reliability** — Twilio trial accounts cannot send to unverified
   numbers. Switch to a full Twilio account or add a fallback SMS provider
   before going live.

3. **CI pipeline** — there is no `.github/workflows/` or equivalent. Add a
   workflow that runs `tsc --noEmit && npm test` on every PR.

4. **Monitoring** — wire `SENTRY_DSN` and add uptime monitoring (e.g., Better
   Uptime pinging `/api/health`).

5. **Face data consent UX** — the API enforces `consent: true` but there is no
   UI consent flow for regular-visitor self-registration. Add a checkbox +
   policy link to the public registration page before enabling face recognition
   for external visitors.
