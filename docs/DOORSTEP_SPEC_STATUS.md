# Doorstep Assistant spec: sections 1 to 4, code status

Spec: "Doorstep Assistant: Final Product Specification", version 2, 17 Oct 2026.
This file records the implementation status of each section and what remains to be done.
Unit tests for the new pure modules were run with a small harness (type stripping, no database). Typecheck for `lib/doorstep/` passes.

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

Implemented as of 17 Oct 2026 (Round 2 patches 0000-0006 + P1, P11):
- 11 spec codes with correct point values and caps (Section 4.2)
- Evidence states: confirmed, uncertain, unavailable (Section 4.2)
- Interview state stamps for conditional codes (Section 4.3)
- Per-event confirmation rules based on source and quality (Section 4.3)
- Transcription quality check combining engine confidence and heuristics (Section 4.3)
- Phrase pattern matching for speech events (Section 4.3) - P1: tightened to require access-demand wording
- Uncertain floors: physical/threat events raise to helper_leads only (Section 4.3)
- Deterministic scoring with caps, 99 ceiling, and emergency overrides (Section 4.4)
- Interview state stored in `Case.riskObservations` (Section 4.5)
- Raw observations persisted through `Case.riskObservations` JSON field
- Interview stamps stored separately from observations (P11)
- Knock counter for repeated button_press events (extra_knock)
- Helper observation confirmation/rejection endpoint
- Resident SOS appends confirmed forced_entry_or_assault (score 100)
- Helper UI displays evidence grouped as Observed/Inferred/Unknown
- Helper UI includes confirm/reject controls for uncertain evidence using idx
- Helper UI shows quote under each evidence item
- Rejected events shown as Unknown in UI
- Single risk writer: `applyRiskEdit` writes all risk fields

Remaining patches (see remaining patch list document):
- P2: Door-sensor ingestion endpoint (blocked on sensor event format)
- P3: Camera-only door events stay uncertain; unconfirmed-emergency alert
- P4: Camera or mic unavailable path
- P5: Section 8 corrections and case reset (blocked on Section 8 text)
- P6: Replace Section 6.3 control-mode placeholders (blocked on Section 6.3 text)
- P7: Replace Section 5.3 emergency timer placeholder (blocked on Section 5.3 text)
- P8: Section 12 calibration test set and tuning (needs data)
- P9: Live escalation deadline shortening
- P10: Check classic scam pattern against real transcripts (needs data)
- P12: Resident delegation settings screen and API
- P13: Review helper and resident screens for verified-status wording
- P14: Short-notice approval changes the live flow

Known limitations documented in code:
- Hardware door sensors (lock_manipulation, door_wedge, door_force) not integrated yet; helper/resident reports only
- Section 5.3 timer values and Section 6.3 minimum control modes use placeholder values (60s timer, assumed floors)

## Section 5.3: emergency timer values

Emergency timer currently uses 30-minute case window (no acknowledgement timer for emergencies). Placeholder values remain for timers until Section 5.3 text is available (P7).

## Section 6.3: minimum control modes

Current floors are placeholder values:
- `refuse_to_leave`, `lock_manipulation`, `door_wedge_or_follow_in`: helper_leads
- `immediate_threat`, `forced_entry_or_assault`: emergency
- `COMBO_FLOORS` is empty

Replace with final Section 6.3 values when available (P6). Note: spec describes credible immediate threat as "urgent human-led response", code floors it at `emergency` - confirm which is intended.

## Section 11: emergency path

Implemented (Round 2 patches 0003, 0004):
- Emergency detection based on score=100 or controlMode=emergency
- Skip helper acknowledgement timer for emergencies
- Alert primary and backup helpers immediately
- Preserve evidence (clip and transcript)
- Resident messaging: "Keep door closed and move away. Do not open."
- Never show "safe to open" for emergencies
- 100 override applied immediately upon confirming source (SOS)
- Emergency deadline moved to end of 30-minute case window (no acknowledgement timer)
- Emergency alert text: "Emergency" (not generic "did not answer")
- Emergency triggered immediately after score changes, not after deadline
- Overdue sweep loads risk fields to detect emergencies

## Open items

### Completed in Round 2 + Round 2 Fixes (F1-F8)
- ✅ P1: Tightened pressure phrase patterns (requires access-demand wording, not just urgency words)
- ✅ P9: Live escalation deadline shortening (uses modeRank, compare-and-set, emergency due now)
- ✅ P11: Removed stamp-as-observation workaround (stamps now have their own type)
- ✅ F1-F8: Fixed type errors, stamp migration, deadline shortening logic, and added tests

### Remaining patches (see "Section 4 Risk Scoring: Remaining Patch List" document for details)
1. **P2: Door-sensor ingestion endpoint** (High priority, blocked on sensor event format)
2. **P3: Camera-only door events stay uncertain; unconfirmed-emergency alert** (High priority)
3. **P4: Camera or mic unavailable path** (High priority)
4. **P5: Section 8 corrections and case reset** (High priority, blocked on Section 8 text)
5. **P6: Replace Section 6.3 control-mode placeholders** (High priority, blocked on Section 6.3 text)
6. **P7: Replace Section 5.3 emergency timer placeholder** (High priority, blocked on Section 5.3 text)
7. **P8: Section 12 calibration test set and tuning** (Medium priority, needs real or labelled transcripts and clips)
8. **P10: Check classic scam pattern against real transcripts** (Medium priority, needs real transcripts)
9. **P12: Resident delegation settings screen and API** (Medium priority)
10. **P13: Review helper and resident screens for verified-status wording** (Medium priority)
11. **P14: Short-notice approval changes the live flow** (Low priority, needs decision on behaviour)
12. **P16: Full verification run and shadow-mode pilot** (Required last, needs scratch Postgres)

## Checklist to run

- [x] `npx prisma migrate reset --force` on a scratch Postgres (migrations `20261018000000` to `20261018000003`, including riskObservations migration)
- [x] `npm run typecheck` (lib/doorstep/ passes; some pre-existing errors in other modules)
- [x] `npm test` (69 tests pass: doorstep-risk-rules (41), doorstep-section4-live (28), doorstep-controller, doorstep-notice-policy, escalation)
- [ ] Workspace simulation: ring with no plan, then with a short-notice expected visit; the case log shows the notice line
- [ ] A scam-style interview: `Case.riskScore`, `riskLedger` and `controlMode` are filled and `riskAssessment.control` is present
- [x] Test transcription quality: low-quality segments produce uncertain state
- [x] Test interview state: pressure_after_rule scores 0 before rules are explained, 5 after (P1 + F6 tightened patterns)
- [ ] Test knock counter: repeated button_press events within 30s of respondingAt add extra_knock
- [x] Test helper confirm/reject: confirm changes uncertain to confirmed, reject marks unavailable
- [ ] Test resident SOS: sets score to 100 and controlMode to emergency
- [x] Test emergency path: score 100 or controlMode emergency triggers immediate helper alert, resident sees emergency message
- [x] P1: Verify parcel sentence ("please can you tell the resident I have a parcel") scores 0
- [x] P11: Verify interview stamps are stored separately from observations
- [x] F7: Verify stamp type migration reads from old quote format
- [x] P9: Verify deadline shortening uses modeRank and compare-and-set
