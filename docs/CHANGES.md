# Production Readiness Changes

This document records every code change made to bring the application from
prototype quality to production-grade. Each section names the problem, what
was changed, which files were touched, and how to verify the fix.

---

## Guardian role removed

Only resident (one), helper (many) and visitors (planned and unplanned) remain. See `docs/ROLES.md`.

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
  helper must generate a new code.
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
  enrolled, a face stayed in the database forever unless a helper manually
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

## Fix 8 — Doorstep Assistant Section 4: Behaviour Risk Scoring

### Problem
The risk scoring system in `lib/doorstep/riskRules.ts` contained placeholder values and did not match
the Section 4 specification. Evidence states, confirmation rules, transcription quality, interview state,
and helper/resident evidence handling were not implemented.

### What changed

**P0: Build baseline fixes**
- Fixed 4 Prisma type errors by adding `@default(cuid())` to model IDs in `prisma/schema.prisma`
- Regenerated Prisma client with `npx prisma generate`

**P1: Risk rules table (Section 4.2)**
- Replaced old behaviours with 11 spec codes: `extra_knock`, `pressure_after_rule`, `pressure_after_boundary`,
  `purpose_contradiction`, `hide_from_helper`, `credential_request`, `refuse_to_leave`, `lock_manipulation`,
  `door_wedge_or_follow_in`, `immediate_threat`, `forced_entry_or_assault`
- Added correct point values and caps per spec
- Added tiered scoring for `purpose_contradiction` (15, then 10)
- Added placeholder control floors (waiting for Section 6.3)

**P2: Evidence states and ledger fields (Section 4.2)**
- Changed `EvidenceState` to `confirmed | uncertain | unavailable`
- Made `retracted` a separate flag (for future Section 8)
- Updated `LedgerEntry` with required fields: `code`, `at`, `quote`, `source`, `state`, `points`, `debug`
- Updated `Observation` with `at`, `quotes`, `segmentQuality`, `phraseMatched`, `transcriptQuality`, `isStamp`

**P3: Per-event confirmation rules (Section 4.3)**
- Implemented confirmation logic in `scoreObservations()`
- Speech events: confirmed only if quote in transcript, quality check passes, and words match category
- Door events: confirmed by sensor or helper
- Unavailable state: zero points
- Uncertain physical/threat events: zero points but may set floor

**P4: Scoring rules (Section 4.4)**
- Implemented distinct event counting
- Applied per-code caps
- Ordinary points capped at 99
- `immediate_threat` sets score to at least 80
- `forced_entry_or_assault` sets score to exactly 100
- Score recomputed only from stored observations (no clock input)

**P5: Transcription-quality signal**
- Added `transcriptQuality` field to `InterrogatorTurnOut` schema
- Implemented `passesTranscriptionQuality()` combining engine confidence and heuristics
- Heuristics: empty/short text, not-understood phrases
- Quality check integrated into scoring logic

**P6: Judge categories and mapping**
- Updated judge categories for new codes
- Renamed `payment_request` to `credential_request` (narrowed to PINs, OTPs, passwords)
- Moved old categories to note-only: `entry_request`, `home_probing`, `official_impersonation`,
  `manipulation_attempt`, `urgency_pressure`
- Updated regex rules and prompts

**P7: Interview state for conditional codes**
- Added `InterviewState` interface with timestamps for conditional code prerequisites
- Added `isStamp` flag to `Observation`
- Created `createInterviewStamp()` helper
- Implemented `stampInterviewState()` in interrogator
- Updated scoring to check interview state prerequisites for `pressure_after_rule`, `pressure_after_boundary`,
  `refuse_to_leave`, `extra_knock`
- Stored interview state in `Case.riskObservations`

**P8: Store raw observations**
- Added `Case.riskObservations Json` field to Prisma schema
- Updated `setCaseAi()` to accept and store risk observations
- Updated interrogator to persist observations from risk assessment
- Schema updated, migration pending database access

**P9: Knock counter and door-sensor intake**
- Implemented `handleExtraKnock()` in `lib/doorbell/store.ts`
- Counts repeated `button_press` events as `extra_knock` within 30-second window
- Respects cap of 5 per spec
- Documented limitation: no hardware door sensor integration yet; helper/resident reports only

**P10: Helper confirm/reject and resident SOS**
- Created `/app/api/doorbell/observation/route.ts` for helper confirmation/rejection
- Updated `raiseSos()` to append confirmed `forced_entry_or_assault` with source `resident`
- SOS sets score to 100 and control mode to emergency
- Helper confirm changes uncertain to confirmed with source `helper`
- Helper reject records correction (marks unavailable with debug note)
- Cross-household requests rejected via household scoping

**P12: Helper screen evidence grouping**
- Updated `InterrogationCard.tsx` to display evidence grouped as Observed/Inferred/Unknown
- Observed: sensors or exact words (confirmed)
- Inferred: system interpretation (helper/resident confirmations, uncertain with floor)
- Unknown: unavailable or unestablished facts
- Added confirm/reject controls for uncertain evidence
- Displays state, source, timestamp, and points

### Files
- `lib/doorstep/riskRules.ts`
- `lib/ai/schemas.ts`
- `lib/ai/agents/interrogator.ts`
- `lib/ai/agents/riskJudge.ts`
- `lib/ai/risk/combine.ts`
- `lib/ai/caseAi.ts`
- `lib/ai/talkback/lines.ts`
- `lib/ai/talkback/types.ts`
- `lib/doorbell/store.ts`
- `app/api/doorbell/observation/route.ts`
- `app/helper/InterrogationCard.tsx`
- `prisma/schema.prisma`
- `tests/doorstep-risk-rules.test.ts`

### Verify
```bash
npm run typecheck  # 0 errors
npm test          # All tests pass, including new P7 interview state tests
```

Test the following scenarios:
- Low-quality transcript produces uncertain state and no points
- Pressure after rule scores 0 before rules explained, 5 after
- Repeated button_press within 30s adds extra_knock
- Helper confirm changes uncertain to confirmed
- Helper reject marks observation as unavailable
- Resident SOS sets score to 100 and emergency mode

---

## Fix 9 — Doorstep Assistant Section 5.3 & 6.3: Emergency path (P11)

### Problem
The emergency path was not implemented. Threats, assault, and forced entry events did not have special handling.
Helper timer was not skipped for emergencies, and resident messaging did not include emergency instructions.

### What changed

**Emergency timer (Section 5.3)**
- Added `EMERGENCY_TIMER_SECONDS = 60` constant in `lib/doorstep/riskRules.ts`

**Emergency detection and escalation**
- Added `isEmergencyCase()` function in `lib/doorbell/escalation.ts` to detect emergencies (score=100 or controlMode=emergency)
- Added `escalateEmergencyCase()` function to handle emergency path:
  - Skips helper acknowledgement timer
  - Alerts primary and backup helpers immediately
  - Sets 60-second timer
  - Logs emergency with evidence preservation note
- Updated `escalateDueCase()` to check for emergency cases first and use emergency path

**Resident view emergency state**
- Added 'EMERGENCY' state to `ResidentViewState` in `lib/state/resident-view.ts`
- Added emergency detection in `computeResidentView()`:
  - Checks `riskScore === 100` or `controlMode === 'emergency'`
  - Returns emergency state with message: "⚠️ EMERGENCY: Keep door closed and move away. Do not open."
  - Red background, canOpen: false

**SOS emergency messaging**
- Updated `alertSos()` in `lib/doorbell/store.ts`:
  - Changed message to: "Keep door closed and move away. Do not open."
  - Added evidence preservation note to log
- Updated `DoorCase` interface to include `riskScore` and `controlMode` fields
- Updated `refreshCasesFromDB()` to load `riskScore` and `controlMode` from database

**Control mode placeholders (Section 6.3)**
- Updated risk rules with placeholder floor comments indicating these are placeholders
- `refuse_to_leave`, `lock_manipulation`, `door_wedge_or_follow_in`: helper_leads
- `immediate_threat`, `forced_entry_or_assault`: emergency

### Files
- `lib/doorstep/riskRules.ts`
- `lib/doorbell/escalation.ts`
- `lib/state/resident-view.ts`
- `lib/doorbell/store.ts`
- `tests/doorstep-risk-rules.test.ts`

### Verify
```bash
npm run typecheck  # 0 errors
npm test          # All tests pass, including new P11 emergency tests
```

Test emergency scenarios:
- SOS sets score to 100 and emergency mode
- immediate_threat sets minimum score to 80 and emergency mode
- forced_entry_or_assault sets score to 100 and emergency mode
- Emergency cases skip helper timer and alert all helpers immediately
- Resident sees emergency message: "Keep door closed and move away. Do not open."

---

## Fix 10 — Doorstep Assistant Section 6: Control Modes and Event Minimums

### Problem
The control mode system used a 4-level scale instead of the 6-mode mapping specified in Section 6. Event floors did not match the spec, and several Section 6 features were not implemented.

### What changed

**P1–P3: Six-mode mapping (M0 to M5)**
- Added `helper_urgent` (M4) mode to `CONTROL_MODES` in `riskRules.ts`
- Updated `MODE_THRESHOLDS` in `collaborationController.ts`:
  - M0 (`ai_leads`): score 0–19
  - M1 (`ai_assisted`): score 20–39
  - M2 (`helper_leads`): score 40–59
  - M3 (`helper_only`): score 60–79
  - M4 (`helper_urgent`): score 80–99
  - M5 (`emergency`): score 100
- Takeover timer now activates at M3 (helper_only) and above, not M2
- Added `modeLabel` field to `Control` object

**P4: Mode wording module**
- Created new `lib/doorstep/modeCopy.ts` with:
  - `MODE_LABEL`: mode to M0..M5 mapping
  - `RESIDENT_SCREEN`: six exact resident texts from spec 6.2 (asked/accepted forms)
  - `residentScreenFor(mode, helperAccepted)` function

**P5: Emergency-only tools gating**
- Added `emergency_guidance` tool (cost 0) to `AUTHORITY_COST`
- Added `EMERGENCY_ONLY_TOOLS` list: `read_log_summarise`, `update_status`, `alert_helper`, `emergency_guidance`
- Updated `gateAction()` to deny emergency-only tools below S_eff 100
- Mapped `safety` and `emergency_guidance` to tools in `LINE_TOOL`

**P6: Talkback lines**
- Added `safety` and `emergency_guidance` line IDs to talkback types
- Added corresponding text in `interrogatorLines()`:
  - `safety`: "Please stay where you are. Keep the door closed." (never claims help is on the way)
  - `emergency_guidance`: "This is an emergency. Follow the safety plan. Stay away from the door."

**P7: Interrogator behaviour by mode**
- M3 and above: when next question is not allowed, return safety line instead of "Thank you. Please wait a moment."
- M2: if confirmed `pressure_after_boundary` appears, stop questioning, say boundary line, and hand over
- Added `pressure_continues` reason to `finishInterrogation`

**P8: Urgent alert at M4**
- Updated `alertUrgent()` to fire whenever S_eff is 80–99 (M4 mode), not just for confirmed threats
- Added `cause` parameter to `alertUrgent()` ('threat' or 'score')
- Generic alert text for score-based urgent alerts

**P9: Helper resolves**
- Added `HELPER_RESOLVABLE` list: events helpers can resolve
- Added `resolvedAt` and `resolvedBy` fields to `Observation`
- Updated `scoreObservations()` to exclude resolved events from floor/minScore calculation
- Added `resolve` action to `applyHelperAction`, `RiskEdit` type, and observation route
- `reset` action now clears resolutions

**P10: Protect resident's SOS from helpers**
- Blocked helper reject and resolve on observations with `source: 'resident'`
- `reset` action does not retract resident-sourced observations

**P11: Resident screen wording**
- Updated `CaseInfo` to include `ackedAt` and `effectiveMode`
- Pass `ackedAt` and effective mode into resident view
- Use `residentScreenFor()` for screen text
- Say "has been asked" until `ackedAt` is set, then "is"

**P12: Keep door closed at M1 and above**
- Updated `computeResidentView()` to check mode rank
- `canOpen` is false at M1 (ai_assisted) and above, regardless of helper answer

**P13: Resident not-safe/keep-closed cannot be overridden**
- Added check in `answerCase()` to prevent helper from overriding resident's not-safe to safe
- Added check in `confirmCase()` to prevent confirming open if resident declined

**P14: M1 helper notification with trigger and next step**
- Added `HELPER_RESPONSE` recommendations from spec 6.3 table in `combine.ts`
- Updated `Assessment` to include `helperResponse` field
- Updated `InterrogationCard` to display helper response recommendation

**P15: Event-specific scripted responses**
- Created new `lib/doorstep/eventResponses.ts` with scripted responses for each behaviour
- Responses run in addition to mode, each goes through action gate
- Integrated into interrogator to check for event responses before next question

**P17: Helper sees both S and S_eff**
- Updated `Risk` interface to include `modeLabel` and `helperResponse`
- Updated `Assessment` to include `modeLabel`
- Updated `InterrogationCard` to display S, S_eff, and mode label

### Files
- `lib/doorstep/riskRules.ts`
- `lib/doorstep/collaborationController.ts`
- `lib/doorstep/modeCopy.ts` (new)
- `lib/doorstep/authorityCosts.ts`
- `lib/doorstep/actionGate.ts`
- `lib/ai/talkback/types.ts`
- `lib/ai/talkback/lines.ts`
- `lib/ai/agents/interrogator.ts`
- `lib/doorstep/caseRiskStore.ts`
- `lib/doorstep/caseRisk.ts`
- `app/api/doorbell/observation/route.ts`
- `lib/state/resident-view.ts`
- `lib/doorbell/store.ts`
- `lib/ai/risk/combine.ts`
- `app/helper/InterrogationCard.tsx`
- `lib/doorstep/eventResponses.ts` (new)
- `tests/doorstep-risk-rules.test.ts`
- `tests/doorstep-controller.test.ts`
- `tests/doorstep-section4-live.test.ts`

### Verify
```bash
npm run typecheck  # 0 errors
npm test          # All tests pass with updated values
```

Test the following scenarios:
- M4 mode triggers urgent alert at score 80–99
- Helper can resolve events (points kept, floor removed)
- Helper cannot reject/resolve resident-sourced observations
- Resident screen shows correct text based on mode and ackedAt
- Door cannot open at M1 or higher
- Helper sees S, S_eff, and mode label
- Event-specific scripted responses trigger on confirmed events

9. **Face data consent UX** — the API enforces `consent: true` but there is no
   UI consent flow for regular-visitor self-registration. Add a checkbox +
   policy link to the public registration page before enabling face recognition
   for external visitors.

10. **Hardware door sensors** — Lock manipulation, door wedge, and door force sensors are not integrated.
    Only helper/resident reports are implemented.

11. **Prisma migration** — The `riskObservations` schema change has not been migrated to the database.
    Run `npx prisma migrate dev` to create and apply the migration when database access is available.
