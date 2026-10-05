# What is verified, what is not, and how to check the rest

This file replaces the optimistic claims in the `V2_PHASE*_STATUS.md` files. Where they disagree, trust this one.

## Verified by automated tests (`npm test`)

| Area | What the tests prove | File |
|---|---|---|
| Escalation steps | next helper, last helper → `no_response`, expected-visit → normal lane, catch-up after downtime | `tests/escalation.test.ts` |
| Exactly-once | two or five servers racing for one step alert once; a restarted server holding a stale copy does not repeat a step; answered or deleted cases are never escalated | `tests/escalation.test.ts` |
| Pass device binding | first use binds; same device OK; other device → 403; two phones racing → one wins; revoked / outside window / bad secret refused | `tests/visitor-pass-binding.test.ts` |

These use an in-memory stand-in for the database that applies the same compare-and-set rule as `claimEscalationStep()`. They prove the logic, not the SQL.

## NOT verified by anything automated (you must run these)

1. The SQL itself (`claimEscalationStep`, `bindIfUnbound`) against a real Postgres.
2. Migrations `0003` and `0004` on a fresh database.
3. Live video, push notifications and SMS on real devices.
4. Passkey registration and sign-in on a real phone. No passkey tests exist yet.
5. The Ring webhook with a real doorbell.

## Manual checklist

Run with a real Postgres (`docker-compose -f docker-compose.postgres.yml up -d`).

**A. Migrations**
- [ ] `npx prisma migrate reset --force` finishes with no error (before this fix it should have failed at `0003`, which used unquoted column names).
- [ ] `npx prisma generate && npm run typecheck` is clean.
- [ ] `npm test` is fully green (the face / regular-visitor / events suites need the generated client).

**B. Escalation survives a restart** (needs `DEMO_MODE=1`, use `/sim`)
- [ ] Start `npm run dev` and `npm run worker`. Press the bell in `/sim`. Helper 1 is asked.
- [ ] Kill the web server (Ctrl+C) before the 30 s deadline passes. Wait 40 s.
- [ ] Worker log shows `Sweep escalated 1 step(s)`; helper 2 gets exactly one alert.
- [ ] Restart the web server. `/helper` shows helper 2 as the current helper, with no repeated alert to helper 1 or 2.
- [ ] Kill the worker mid-case, restart it: no duplicate alerts.
- [ ] Run **two** web servers (`next dev -p 3000` and `next dev -p 3001`) against one database, ring once: each helper is alerted once.

**C. Visitor pass**
- [ ] As guardian: `POST /api/visitor/passes` with a window containing "now". Copy `link` from the response.
- [ ] Open the link on phone A: "Your pass is ready". Open it again on phone A: still OK.
- [ ] Open the same link on phone B (or a private window): "already in use on a different device" (HTTP 403).
- [ ] `DELETE /api/visitor/passes/<id>` as guardian, then reopen on phone A: "cancelled".
- [ ] As a helper (not guardian), `GET /api/visitor/passes` returns 403.
- [ ] Hit `/api/visitor/arrival` 21 times in 10 minutes from one IP: the 21st returns 429.

**D. Passkey (phone)**
- [ ] Register a passkey in the helper app, sign out, sign in with it.
