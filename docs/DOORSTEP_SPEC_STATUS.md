# Doorstep Assistant spec: sections 1 to 3, code status

Spec: "Doorstep Assistant: Final Product Specification", version 2, 17 Oct 2026. Sections 1 to 3 only.
This file records what the patch series in `docs/patches/` implements and what is still open.
Unit tests for the new pure modules were run with a small harness (type stripping, no database). The Prisma
migrations, `prisma generate`, `tsc` and the full `vitest` suite have NOT been run. See the checklist at the end.

## Section 1: principles

| Principle | Status | Where |
|---|---|---|
| AI leads at low risk, human leads at high risk | Done | `lib/doorstep/collaborationController.ts` (`modeForScore`, `computeControl`) |
| Notice policy and risk are separate | Done | `noticePolicy.ts` returns `riskPoints: 0` as a literal type; `store.ts` never passes notice into scoring |
| Risk only from observed behaviour | Done for scoring | `riskRules.ts` has no input for appearance, accent, nervousness, face or camera quality. Vague, evasive and unverifiable answers are notes with 0 points |
| AI extracts facts, code decides | Done | The model returns evidence (category + quote). `RiskJudgeOut.level` and `riskHint` are ignored for scoring |
| AI never unlocks or discloses credentials | Done | `ALWAYS_PROHIBITED` in `residentPreferences.ts`; tested for every mode |
| Silence is never consent | Done (existing) | `lib/doorbell/escalation.ts` ends in `no_response` = keep door closed |
| Resident stays in control | Partly | Delegation settings exist in data and logic. No screen or API edits them yet |
| Report only verified status | Not checked | Needs a separate review of the helper and resident screens |

## Section 2: modules

| Module | File |
|---|---|
| `noticePolicy.ts` | `lib/doorstep/noticePolicy.ts` |
| `riskRules.ts` | `lib/doorstep/riskRules.ts` (plus `lib/ai/risk/combine.ts` as the adapter) |
| `residentPreferences.ts` | `lib/doorstep/residentPreferences.ts`, `lib/db/preferences.ts` |
| `collaborationController.ts` | `lib/doorstep/collaborationController.ts` |
| `helperEscalation.ts` | `lib/doorstep/helperEscalation.ts` (re-exports the existing, tested engine) |

## Section 3: minimum-notice policy

Done: `meets_minimum` / `short_notice` / `no_notice`, three household settings, `ExpectedVisit.arrangedAt`,
`Case.noticeStatus`, a case-log line for short-notice visits.

## Open items

1. **Live escalation timers.** The controller computes the three timers and `Case.controlMode` is saved, but the
   escalation deadline is still set when the case opens (before any score exists). Shortening a waiting case's
   deadline when the score rises needs a compare-and-set change in `store.ts` and a restart test. Not done on purpose.
2. **Spec section 5.3 values.** `TIMER_CURVE`, `MODE_THRESHOLDS` and every number in `RISK_RULES` are starting values.
   Replace them with the final table. Spec sections 4, 5, 6 and 8 were not in the text provided.
3. **Short-notice approval is only logged.** Expected-visit cases already need a helper tap. `resident_approval` and
   `ai_handles` are stored and returned by `evaluateNotice` but do not yet change the live flow.
4. **No screens.** Nothing edits notice settings or preferences, and the helper card does not show the score,
   the ledger or the control mode yet (all are in `Case.riskAssessment` and the new columns).
5. **Sensor events.** `lock_tampering`, `forced_entry`, `threat` and `refusal_to_leave` can only be confirmed by a
   sensor, the resident or a helper. Nothing produces those observations yet.
6. **Classic scam pattern.** Under the starting values it reaches `helper_leads` through a combination floor, but its
   points are low (28). Check this against real transcripts before a pilot.
7. **Case lifecycle (section 8)**: accumulation, correction, reset, new visitors. `Observation.retracted` is the hook; no lifecycle code.

## Checklist to run

- [ ] `npx prisma migrate reset --force` on a scratch Postgres (migrations `20261018000000` to `20261018000002`)
- [ ] `npx prisma generate && npm run typecheck`
- [ ] `npm test` (new: `doorstep-notice-policy`, `doorstep-risk-rules`, `doorstep-controller`; changed: `ai-core`)
- [ ] `/sim`: ring with no plan, then with a short-notice expected visit; the case log shows the notice line
- [ ] A scam-style interview: `Case.riskScore`, `riskLedger` and `controlMode` are filled and `riskAssessment.control` is present
