# Section 5 remediation — exact implementation changes

This patch updates the `ring-main (50).zip` project. It implements the Section 5 timer lifecycle more consistently, but it is **not a substitute for running the full test suite and migrations against PostgreSQL**.

## Files changed

- `lib/doorstep/deadline.ts`
  - Keeps approval, risk-decision, takeover and legacy household deadlines in a separate `timerDeadlines` map.
  - Chooses `deadlineAt`/`deadlineKind` from the earliest active deadline (takeover wins equal-deadline ties).
  - Uses compare-and-set updates against status, deadline, kind and map to avoid losing concurrent changes.
  - Adds `clearAllTimerDeadlines()` for explicit timerless/emergency states; cancellation promotes the next active timer or marks the case timerless.
  - Does not allow regular timers to be re-added while a case is in emergency state.

- `lib/doorbell/escalation.ts`
  - Uses the independent timer map to determine expiry and avoids escalating early due to a stale cached `deadlineAt`.
  - Chooses the strongest timer behavior if several timers have expired, performs one escalation step per helper response window, and refreshes the next helper's active timer windows.
  - Passes the expired timer kind and behavior to the notification handler so a takeover expiry keeps the primary helper alerted.
  - Treats explicit `none` and `emergency` states as timerless.

- `lib/doorstep/caseRiskStore.ts`
  - Records risk-decision and takeover deadlines as distinct timer reasons from the effective score/event floor.
  - Clears acknowledgement timers on a confirmed immediate threat or emergency override and restores timers only after an authenticated correction removes that override.
  - Records the AI-action approval request as `risk_decision`, even when its timer duration ties the takeover timer.

- `lib/doorstep/helperEscalation.ts`
  - Preserves the `120 - S_eff` duration for an already-active AI-action timer below M1, instead of accidentally replacing it with the household timeout when escalating to a backup.

- `lib/doorbell/store.ts`
  - Reconciles legacy and independent timers at startup.
  - Gives overdue active timers a five-second restart grace while preserving timers that are still in the future.
  - Makes the timer map authoritative during the in-memory tick check.
  - Keeps the expected-visitor fallback timer synchronized with its timer map and clears acknowledgement timers before emergency alerts.

- `lib/db/cases.ts`
  - Adds `deadlineKind` and timer-map compare-and-set guards to escalation claims.
  - Excludes explicit timerless and emergency cases from the ordinary overdue-timer sweep.

- `app/api/doorbell/escalate/route.ts`
  - Starts the next helper with the active timer reasons and their correct per-reason durations.
  - Avoids mismatching SQL JSON-null state against an empty-object map in the optimistic concurrency check.
  - Rejects ordinary acknowledgement escalation for SOS/emergency cases.

- `tests/doorstep-deadline.test.ts`, `tests/escalation.test.ts`
  - Cover independent timer persistence, cancellation, timerless/emergency behavior, stale deadlines, backup windows, timer expiry behavior, and low-score AI-action timers.

- `prisma/migrations/20261020041500_section5_timer_state_cleanup/migration.sql`
  - Normalizes old timer maps and removes invalid timer keys/states.

- `Doorstep Assistant … UI Test Guide …md`, `docs/DOORSTEP_SPEC_STATUS.md`
  - Updates the timer test instructions and removes outdated timer-formula status text.

## Apply the patch instead of copying individual snippets

Run from the root of the existing `ring-main` project:

```bash
patch -p1 < SECTION5_FIXES.patch
```

Alternatively, use the complete `ring-main-section5-fixed.zip` as the updated source tree. Back up your current project before applying either option.

## Required verification

Use a **disposable PostgreSQL database**, not production:

```bash
npm ci
npx prisma generate
npx prisma migrate deploy
npm run typecheck
npx vitest run tests/doorstep-deadline.test.ts tests/escalation.test.ts
npm test
```

Then run these integration scenarios against the running app and database:

1. Score 0 and an ordinary unannounced visitor: no risk-driven timer is active.
2. Score 20: risk-decision timer is 100 seconds.
3. Score 60: takeover timer is 60 seconds; on expiry the backup is notified and the primary remains alerted.
4. Score 80: all helpers receive the urgent alert immediately; the takeover deadline is 40 seconds.
5. Short-notice visit requiring approval: the configured approval timer expires to the backup, the door stays closed and AI remains on the holding script.
6. Score/action creates simultaneous timer reasons: each reason remains stored independently and `deadlineAt` equals the earliest active timer.
7. When two or more timers are expired at a delayed worker sweep, exactly one escalation step occurs; the strongest expired reason decides the alert behavior.
8. After the last helper times out, the case is `no_response`, all acknowledgement timers are cleared, and silence never approves the visit.
9. Confirmed immediate threat, SOS and score-100 emergency: acknowledgement timers are cleared and no ordinary timeout re-escalation occurs.
10. Restart the web process and timer worker with due and future timers; the map and governing deadline remain consistent, and duplicate alerts are not emitted.

## What still prevents a verified “complete” status

- The current environment could not install the repository dependencies, so Vitest, `prisma generate`, migration application, and `npm run typecheck` have **not** been run against this patched tree.
- Release-default timer values still need validation with intended residents, their chosen supporters, and safeguarding professionals, as required by the product specification.
- Do not deploy this patch to a real home based only on syntax checks or unit tests. Confirm every release criterion and test failure before release.
