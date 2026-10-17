# Doorstep Assistant spec: sections 1 to 4, code status

Spec: "Doorstep Assistant: Final Product Specification", version 2, 17 Oct 2026. Sections 1 to 4 implemented.
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

## Section 4: behaviour risk scoring

Implemented as of 17 Oct 2026 (P0-P10, P12-P13 patches):
- 11 spec codes with correct point values and caps (Section 4.2)
- Evidence states: confirmed, uncertain, unavailable (Section 4.2)
- Interview state stamps for conditional codes (Section 4.3)
- Per-event confirmation rules based on source and quality (Section 4.3)
- Transcription quality check combining engine confidence and heuristics (Section 4.3)
- Deterministic scoring with caps, 99 ceiling, and emergency overrides (Section 4.4)
- Interview state stored in `Case.riskObservations` (Section 4.5)
- Raw observations persisted through `Case.riskObservations` JSON field
- Knock counter for repeated button_press events (extra_knock)
- Helper observation confirmation/rejection endpoint
- Resident SOS appends confirmed forced_entry_or_assault (score 100)
- Helper UI displays evidence grouped as Observed/Inferred/Unknown
- Helper UI includes confirm/reject controls for uncertain evidence

Known limitations documented in code:
- Hardware door sensors (lock_manipulation, door_wedge, door_force) not integrated yet; helper/resident reports only
- Section 5.3 timer values and Section 6.3 minimum control modes use placeholder values (60s timer, assumed floors)

## Section 5.3: emergency timer values

Implemented with 60-second timer value (Section 5.3 placeholder).

## Section 6.3: minimum control modes

Implemented with placeholder control floors (Section 6.3):
- `refuse_to_leave`, `lock_manipulation`, `door_wedge_or_follow_in`: helper_leads
- `immediate_threat`, `forced_entry_or_assault`: emergency

## Section 11: emergency path

Implemented (P11):
- Emergency detection based on score=100 or controlMode=emergency
- Skip helper acknowledgement timer for emergencies
- Alert primary and backup helpers immediately
- Preserve evidence (clip and transcript)
- Resident messaging: "Keep door closed and move away. Do not open."
- Never show "safe to open" for emergencies
- 100 override applied immediately upon confirming source (SOS)
- 60-second timer for emergency cases

## Open items

1. **Section 5.3 timer values.** Emergency timer set to 60 seconds (placeholder). Replace with final spec values if different.
2. **Section 6.3 minimum control modes.** Control mode thresholds use placeholder values (helper_leads for physical codes, emergency for threats). Replace with final spec values.
3. **Section 8 corrections and case reset.** `Observation.retracted` is defined but correction lifecycle code is not implemented.
4. **Section 12 calibration test set.** Test data for confidence rule verification is not defined.
5. **Live escalation timers.** The controller computes the three timers and `Case.controlMode` is saved, but the
   escalation deadline is still set when the case opens (before any score exists). Shortening a waiting case's
   deadline when the score rises needs a compare-and-set change in `store.ts` and a restart test. Not done on purpose.
6. **Short-notice approval is only logged.** Expected-visit cases already need a helper tap. `resident_approval` and
   `ai_handles` are stored and returned by `evaluateNotice` but do not yet change the live flow.
7. **Sensor events.** Hardware door sensors (lock_manipulation, door_wedge, door_force) can only be confirmed by a
   sensor, the resident or a helper. Only helper/resident reports are implemented; hardware integration is pending.
8. **Classic scam pattern.** Under the starting values it reaches `helper_leads` through a combination floor, but its
   points are low (28). Check this against real transcripts before a pilot.

## Checklist to run

- [ ] `npx prisma migrate reset --force` on a scratch Postgres (migrations `20261018000000` to `20261018000002`, plus new riskObservations migration)
- [ ] `npx prisma generate && npm run typecheck`
- [ ] `npm test` (new: `doorstep-notice-policy`, `doorstep-risk-rules`, `doorstep-controller`; changed: `ai-core`, `code-mode`)
- [ ] Workspace simulation: ring with no plan, then with a short-notice expected visit; the case log shows the notice line
- [ ] A scam-style interview: `Case.riskScore`, `riskLedger` and `controlMode` are filled and `riskAssessment.control` is present
- [ ] Test transcription quality: low-quality segments produce uncertain state
- [ ] Test interview state: pressure_after_rule scores 0 before rules are explained, 5 after
- [ ] Test knock counter: repeated button_press events within 30s of respondingAt add extra_knock
- [ ] Test helper confirm/reject: confirm changes uncertain to confirmed, reject marks unavailable
- [ ] Test resident SOS: sets score to 100 and controlMode to emergency
- [ ] Test emergency path: score 100 or controlMode emergency triggers immediate helper alert, resident sees emergency message
