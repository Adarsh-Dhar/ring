# Doorstep Assistant spec: sections 1 to 4, code status

Spec: "Doorstep Assistant: Final Product Specification", version 2, 17 Oct 2026.
This file records the implementation status of each section and what remains to be done.

## Section 1: principles

| Principle | Status | Where |
|---|---|---|
| AI leads at low risk, human leads at high risk | Done | `lib/doorstep/collaborationController.ts` (`modeForScore`, `computeControl`) |
| Notice policy and risk are separate | Done | `noticePolicy.ts` returns `riskPoints: 0` as a literal type; `store.ts` never passes notice into scoring |
| Risk only from observed behaviour | Done for scoring | `riskRules.ts` has no input for appearance, accent, nervousness, face or camera quality. Vague, evasive and unverifiable answers are notes with 0 points |
| AI extracts facts, code decides | Done | The model returns evidence (category + quote). `RiskJudgeOut.level` and `riskHint` are ignored for scoring |
| AI never unlocks or discloses credentials | Done | `ALWAYS_PROHIBITED` in `residentPreferences.ts`; tested for every mode |
| Silence is never consent | Done (existing) | `lib/doorbell/escalation.ts` ends in `no_response` = keep door closed |
| Resident stays in control | Done | Delegation settings screen and API in `app/resident/DelegationSettings.tsx` and `app/api/resident/delegation/route.ts` |
| Report only verified status | Done | Helper and resident screens use conservative wording |

## Section 2: modules

| Module | File |
|---|---|
| `noticePolicy.ts` | `lib/doorstep/noticePolicy.ts` |
| `riskRules.ts` | `lib/doorstep/riskRules.ts` (plus `lib/ai/risk/combine.ts` as the adapter) |
| `residentPreferences.ts` | `lib/doorstep/residentPreferences.ts`, `lib/db/preferences.ts` |
| `collaborationController.ts` | `lib/doorstep/collaborationController.ts` |
| `helperEscalation.ts` | `lib/doorstep/helperEscalation.ts` |

## Section 3: minimum-notice policy

Done: `meets_minimum` / `short_notice` / `no_notice`, three household settings, `ExpectedVisit.arrangedAt`,
`Case.noticeStatus`, a case-log line for short-notice visits.

## Section 4: behaviour risk scoring

Implemented as of Round 5 (18 Oct 2026):

### Core scoring
- 11 spec codes with correct point values and caps (Section 4.2)
- Evidence states: confirmed, uncertain, unavailable (Section 4.3)
- Interview state stamps for conditional codes (Section 4.3)
- `entryDeniedAt` precondition for `lock_manipulation` (sensor timestamp check with 60 s clock-skew tolerance)
- Per-event confirmation rules based on source and quality (Section 4.3)
- Transcription quality check combining engine confidence and heuristics (Section 4.3)
- Phrase pattern matching for speech events (Section 4.3) — tightened to require access-demand wording
- Uncertain floors: physical/threat events raise to `helper_leads` only (Section 4.3)
- Deterministic scoring with caps, 99 ceiling, and emergency overrides (Section 4.4)
- Interview state stored in `Case.riskObservations` (Section 4.5)
- Raw observations persisted through `Case.riskObservations` JSON field
- Interview stamps stored separately from observations (P11)
- Stable observation ids (`Observation.id`, `LedgerEntry.obsId`, `Correction.obsId`) — position-independent corrections
- `_before: {state, source}` saved on confirm so restore undoes it exactly

### Evidence states
- Camera/mic unavailable path fully wired: `setDeviceOnline` marks camera unavailable on all open cases; `openCase` stamps unavailable at creation if device is offline; audio route marks mic unavailable on transcription failure, empty audio, or unsupported state
- `availability` edit kind in `applyRiskEdit`; `StoredRisk.availability` persisted
- InterrogationCard shows "Camera offline since…" and "Microphone unavailable" in the Unknown group

### Control
- `immediate_threat` floor: `helper_only` (Option A — emergency is reserved for forced entry/assault/SOS)
- `MODE_THRESHOLDS`: emergency at score ≥ 100; 60–99 → `helper_only`
- `alertUrgent` (spec 4.4 rule 5): confirmed threat triggers immediate all-helper alert, exactly once via `urgentAlertedAt` DB claim; helper-acknowledgement timer bypassed
- `RISK_SHADOW=1`: stores score without driving controller or sending alerts (P16 shadow mode)
- G4 alert restricted to uncertain `forced_entry_or_assault` only (not `immediate_threat`)

### Sensors
- `app/api/doorbell/sensor/route.ts`: HMAC-SHA256, ±5 min timestamp window, idempotency via WebhookEvent, rate limiting
- `lib/schemas/sensor.ts`: `knock`, `lock_tamper`, `door_wedge`, `door_force`, `tamper` event types
- `SENSOR_HMAC_KEY` in env-validate

### Corrections (Section 8)
- `reset` edit kind: soft-retracts all observations, preserves audit trail, score → 0
- Restore undoes prior confirm back to pre-confirm state
- `applyHelperAction` routes by obsId first; returns error for unknown id
- Observation route supports `obsId`, `reset` action, and returns errors instead of silent no-ops
- InterrogationCard: restore button with reason prompt on rejected entries; action errors shown inline

### Simulation
- Sim route and SimulationPanel: lock_tamper, door_wedge, door_force, tamper buttons and camera-uncertain-forced-entry
- `entry_not_permitted` fixed talkback line added; stamps `entryDeniedAt`

### Calibration
- `scripts/calibrate-risk.ts`: precision/recall per code, false-positive guard on spec 4.1 zero-score phrases
- `tests/fixtures/section12/`: synthetic fixture set (credential-request, immediate-threat, refuse-to-leave)
- `npm run calibrate` runs the harness; exits non-zero on fixture failures

## Section 5.3: emergency timer values

Spec 4.4 rule 5: confirmed `immediate_threat` bypasses the acknowledgement timer — done via `alertUrgent`.
General score-based timer interpolation: done (DEFAULT_ESCALATION_SECONDS → 10 s at score 100).
Timer placeholders remain until Section 5.3 values are confirmed.

## Section 6.3: minimum control modes

**Implemented (P6): Six-mode mapping (M0 to M5)**

Mapping:
- M0 (`ai_leads`): score 0–19
- M1 (`ai_assisted`): score 20–39
- M2 (`helper_leads`): score 40–59
- M3 (`helper_only`): score 60–79
- M4 (`helper_urgent`): score 80–99
- M5 (`emergency`): score 100

Event floors (spec 6.3 table):
- `pressure_after_boundary`, `purpose_contradiction`, `hide_from_helper`, `credential_request`: floor `ai_assisted` (M1)
- `refuse_to_leave`, `lock_manipulation`, `door_wedge_or_follow_in`: floor `helper_only` (M3)
- `immediate_threat`: floor `helper_urgent` (M4)
- `forced_entry_or_assault`: floor `emergency` (M5)

Uncertain floors:
- `lock_manipulation`, `door_wedge_or_follow_in`, `immediate_threat`, `forced_entry_or_assault`: uncertain → `helper_only` (M3)

Additional Section 6 features implemented:
- P1–P3: M4 mode added, controller thresholds updated, takeover timer at M3+
- P4: `modeCopy.ts` with MODE_LABEL and RESIDENT_SCREEN texts
- P5: Emergency-only tools gating (including `emergency_guidance`)
- P6: Safety and emergency_guidance talkback lines
- P7: Interrogator behaviour by mode (M2 pressure_continues, M3+ safety line)
- P8: Urgent alert at S_eff 80–99 (M4), not just for confirmed threats
- P9: Helper resolve functionality (HELPER_RESOLVABLE, resolvedAt/resolvedBy fields)
- P10: Resident-sourced observations protected from helper reject/resolve
- P11: Resident screen wording using residentScreenFor
- P12: Door cannot open at M1 or higher
- P13: Resident not-safe/keep-closed cannot be overridden by helpers
- P14: Helper notification with trigger and next step (HELPER_RESPONSE recommendations)
- P15: Event-specific scripted responses (`eventResponses.ts`)
- P17: Helper sees both S and S_eff with mode label

## Section 11: emergency path

- Emergency detection via `controlMode === 'emergency'` or `riskScore === 100`
- `alertEmergency`: exactly-once claim via `emergencyAlertedAt` DB column (migration 0004)
- `alertUrgent`: exactly-once claim via `urgentAlertedAt` DB column (migration 0005)
- `alertUnconfirmedEmergency`: exactly-once claim via `unconfirmedAlertedAt` DB column (migration 0004)

## Open items (remaining)

1. **P8/P10: Calibration** — real or role-played labelled transcripts needed before pilot weights count as calibrated. Supply them as JSON fixtures in `tests/fixtures/section12/` and run `npm run calibrate`.
2. **P14: Short-notice approval changes the live flow** — needs decision on behaviour.
3. **P16: Full verification run** — needs scratch Postgres with all migrations applied (0000–0005).
4. **Section 5.3 timer values** — placeholders; confirmed by text review only.
5. **Section 6.3 final floors** — Option A chosen; confirm against final spec text.
6. **Real hardware sensor testing** — `SENSOR_HMAC_KEY` and device format unverified against physical devices.

## Checklist

- [x] `npx prisma generate && npm run typecheck` — 0 real errors (Prisma engine download errors are environment-only)
- [x] `npm test` — 434 pass, 7 pre-existing `ai-core` failures (unrelated to phase 4); escalation tests now pass
- [x] `npm run calibrate` — 12 synthetic fixtures, 0 failures
- [x] Sensor buttons exist in SimulationPanel (lock tamper, door wedge, door force, tamper, camera uncertain)
- [x] `RISK_SHADOW=1` env var wired — suppresses all three alert paths without affecting scoring
- [x] P2 done: `app/api/doorbell/sensor/route.ts` with HMAC, idempotency, rate limiting, household lookup
- [x] P4/G5 done: camera availability wired in `setDeviceOnline` and `openCase`; mic availability wired in audio route
- [x] P5 done: `reset` edit kind, restore with `_before` state, obsId routing, route enforces reason on restore
- [x] P6 done: Option A floors — `immediate_threat` → `helper_only`, `emergency` at score ≥ 100
- [x] P7 done: `alertUrgent` with `urgentAlertedAt` migration bypasses ack timer for confirmed threats
- [x] `grep -rn "riskObservations:\|riskScore:\|controlMode:" lib app` — writes only in `caseRiskStore.ts`
- [ ] Workspace simulation: ring, run scam script; verify riskScore, riskLedger, controlMode, riskAssessment.control fill in
- [ ] Device offline during ring: verify `riskObservations.availability.camera` is set on the case
- [ ] Sensor sim buttons: lock tamper without entryDeniedAt stamp → score 0; add stamp → score 30
- [ ] `RISK_SHADOW=1` runtime check: run a scam, confirm score stored but no SMS/push sent to helpers
- [ ] Supply real labelled transcripts for section 12 calibration before calling weights "calibrated"
