# Spec sections 9 to 12: what was added (20 Oct 2026)

Sections 1 to 8 were already in the code. This pass adds 9 to 12. All numbers remain pilot values (spec 12).

## 9. Tools

| Spec item | Where |
|---|---|
| 9.1 tool table (14 tools, cost, "alone through S_eff") | `lib/doorstep/toolRegistry.ts` (`SPEC_TOOLS`), costs in `authorityCosts.ts`. "Alone through" is derived as 100 - cost. Spec names and the older names are interchangeable (`canonicalTool`) |
| One entry point for a model's tool call | `lib/doorstep/aiTools.ts` `executeAiToolCall()`. Unknown name -> refused and logged |
| Checks in code, refusals logged | `toolDispatcher.ts`: `dispatchAiAction` (speech) and new `dispatchTool` (non-speech). Order: prohibited, helper-only, emergency-only, resident restriction, budget |
| `report_observation` cannot set a score | `lib/doorstep/toolInputs.ts` `validateObservationInput`: refuses score/floor/mode/timer/permission fields; a camera report or an ungrounded quote is never "confirmed" |
| `summarize_evidence` Observed / Inferred / Unknown, speech labelled as a claim | `toolInputs.ts` `buildEvidenceSummary` |
| `preserve_evidence` under resident retention | `aiTools.ts` + `privacy.ts` |
| 9.2 controller tools | `controllerRules.ts` (when the rules say yes), `controllerTools.ts` (runs it). The AI may ask for 4; `escalate_to_backup`, `enforce_entry_policy`, `trigger_emergency_workflow` are rule-only and refused if the AI asks |
| `request_evidence_confirmation` | New helper-request kind `evidence_confirmation` (no migration: `kind` is a string). Sent automatically for every uncertain observation reported through `report_observation` |
| 9.3 never allowed | `PROHIBITED_TOOLS` now also covers labelling a visitor dangerous/criminal, emergency services on a score, silence as consent. Policy exception stays helper-only |
| 9.4 observation codes | Already the 11 codes in `riskRules.ts`. `hide_from_helper` wording widened to "bypass the process / avoid verification" |
| 9.5 AI unavailable | `analysisAvailability.ts`: marks the case, adds 0 points, tells the helper once. Wired into the interrogator failure paths. Helper card shows it |

## 10. Decision packet

`lib/doorstep/decisionPacket.ts` (pure) and `decisionPacketStore.ts`; read-only API `GET /api/doorbell/packet?caseId=`.
It reproduces the 10.2 example exactly (tested). Extra fields under `extra` (mode name, approver, per-tool access).

## 11. Privacy and reliability

- Audit log is hash-chained and verifiable: `auditChain.ts`, `audit.ts` (SHA-256 computed inside the same UPDATE, under the row lock). `verifyAuditChain(case.log)` finds the first edit, deletion or reorder.
- The escalation step used to overwrite the whole `Case.log`; it now appends (`lib/db/cases.ts`).
- Retention and AI video-analysis switch: `privacy.ts`, stored in the existing resident preferences JSON (`preferences.privacy`), saved by the existing delegation API. No migration.
- Outage table, every row asserted: `failureModes.ts`.
- Face recognition is never a scoring input (asserted by a test).

## 12. Validation

`tests/doorstep-section9-12.test.ts` (34 checks: every table row, every pass-or-fail release criterion that can be tested without a database).
`tests/fixtures/section12/scenarios-9-12.json`: 8 more synthetic scenarios (prompt injection, ambiguous speech, legitimate visitors). `npm run calibrate`: 20 fixtures, 0 failures.

## Decisions for you

1. **Questions per case.** Spec 9.1 says at most two. The old code ran an open interview (minimum 4 answers, no cap). Now two by default; `AI_VISITOR_QUESTION_LIMIT` changes it.
2. **Policy exception** is listed under "never allowed" in 9.3 but its reason says "needs helper approval". Implemented as helper-only (an AI request creates a helper decision; the AI never grants one).
3. **Immediate threat** raises the packet's `isEmergencyOverride`, but the existing Option A behaviour (M4 urgent alert to all helpers, not the M5 emergency call) is unchanged.
4. **Helper multi-factor sign-in** (11.1): sign-in is Google-only, so MFA is whatever the helper's Google account enforces. The app does not enforce it itself.

## Not done, and why

- **Not run:** the full vitest suite, `tsc` over the whole project, and the database paths (hash-chained SQL, append-only escalation log, helper requests). The package registry was blocked in my sandbox. Please run `npm install && npm test && npm run typecheck` and apply no migrations (none were added). The hash SQL needs PostgreSQL 11+ (`sha256()`); on older versions it falls back to an unchained append.
- **No retention deletion job.** Retention periods are an open decision (12.4); today only the plan is computed and logged.
- **No resident screen for the privacy settings** (the API accepts `preferences.privacy`; only the data layer is done).
- Open decisions in 12.4 (timers, quiet period, who logs "notice given", third contact) are unchanged.
- A new `report_observation` observation appended by the AI can be replaced by the interrogator's next full model pass (existing merge rule for untouched transcript observations).
