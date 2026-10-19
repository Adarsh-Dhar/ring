# Section 7: status (honest version)

Section 7 is NOT complete. This replaces an earlier version that claimed 100%.

## Done (backend)
Helper request state machine with dedupe, contact log, audit, single-use approvals, tier-ordered contact chain,
approval retry sweep, scoped timeouts, guarded routes (/action, /accept, /escalate, /members/[id]).

## Verified
`tsc --noEmit` clean (Prisma-client types excluded). DB-free tests pass (tests/doorstep-section7-pure.test.ts, and
the rest of the suite except files that need a generated Prisma client).

## Not verified
Every test that needs a database, including tests/doorstep-section7.test.ts and migration 20261019000009.
Run `npm ci && npx prisma migrate deploy && npm test` against Postgres before trusting it.

## Not done
- UI: nothing calls the new routes. No request state on the resident screen, no shared case view,
  no helper controls, no audit panel.
- 7.3 resident controls: contact order, sensory settings, "revoke all delegations".
