# AI agents

Five advisory agents. **None of them is on the alert path**: the helper push/SMS, escalation timer and resident
screen behave exactly as before if AI is off, slow, over quota or wrong.

## Turn it on
1. `npx prisma migrate deploy` (migrations `20261015000000_ai_agents`, additive only).
2. Set `GEMINI_API_KEY` and the model IDs in `.env` (see `.env.example`).
3. Guardian: `POST /api/ai/kill {"aiEnabled": true, "aiInterrogator": true}` (both default to **false** per household).
4. **Where AI jobs run.** By default the interrogator runs **inline** in the web process, so no worker is needed (this is also how Docker runs out of the box). Set `AI_USE_QUEUE=1` only if you run a worker (`npm run worker`, or `docker compose --profile worker up -d`); jobs for real devices are then queued, and any queue failure falls back to inline. Simulator devices (`sim-*`) in the workspace simulation always run inline. The worker is still needed for the Monday digest schedule.

## Agents
| Agent | Model role | Trigger | Output (who sees it) |
|---|---|---|---|
| Door Interrogator | workhorse (audio) | ring (`AI_INTERROGATOR_START`), reply via `POST /api/ai/interrogator/audio` | real-reason summary + verdict + claims + risk flags → helper (unplanned visits only) |
| Risk Judge | workhorse (text, may fall back to Gemma) | end of every interrogation, plus a live hint on each turn | risk level (none/low/medium/high) + categories + quoted evidence + one-line reason → helper (helper-only) |
| Note Compressor | workhorse → Gemma fallback | `POST /api/ai/notes` | ≤8-word sentence + icon; **resident sees it only after helper approval** |
| Visit Intake | workhorse (text) | `POST /api/visit-requests/public/[token]/intake` | verdict note on the VisitRequest → helper |
| Digest | quality | weekly cron / `POST /api/ai/digests/run` | ~80-word weekly summary → guardian |

## Safety rules (enforced in code, covered by `tests/ai-core.test.ts`)
- The doorbell only ever says 3 fixed lines for the opener, reprompt, and close (`lib/ai/talkback/lines.ts`). Follow-up questions are model-worded but validated (≤20 words, no banned phrases, no resident name).
- Visitor/calendar/helper text is wrapped in `<untrusted_data>` blocks and sanitised; it never reaches the instruction part of a prompt.
- Every model output is zod-validated, word-clamped and checked against banned phrases; failure ⇒ "no AI result".
- Intake: the LLM only extracts claims and words one ≤20-word question. Calendar/known-visit lookups are done by code
  (±2h of the claimed time, minimal fields) and the verdict is computed deterministically. The visitor is never told
  what is or isn't expected. Calendar text is never sent to the model.
- Risk level = max(AI judge, keyword-rule floor). The model can raise a level but never lower it below the rules. Every model claim must quote the visitor and the quote is checked against the real transcript in code; a medium/high verdict with no verifiable quote is capped at low. If the judge is off, slow (`AI_RISK_TIMEOUT_MS`) or over budget, the rules still produce a level. Risk output is helper-only and never reaches the visitor or resident. Set `AI_RISK_JUDGE=0` to use keyword rules only.
- Budgets (`lib/ai/budget.ts`) are per model RPM/RPD in Redis (in-memory fallback). Out of budget ⇒ degrade, never error.
- Audio/images never fall back to the text-only Gemma model.
- Every call is logged to `AiRun`; `GET /api/ai/usage` shows the last 24h.

## Not done / needs your input
- **Ring talk-back**: `lib/ai/talkback/ring.ts` is a stub. No speaker/two-way audio endpoint is verified in
  `lib/ring/client.ts`. Until implemented, real rings set `interrogationState = 'unsupported'`; the interrogator works in the workspace simulation.
- **Model IDs** are placeholders (could not be verified as API IDs). Set them in `.env`.
- **Calendar owner**: intake checks *every* approved guardian who connected Google Calendar (union).
- **Privacy**: free-tier Gemini data may be used for training. Use a paid key before sending real door audio/images.
- Visitor UI for the intake questions (`app/visit/[token]/page.tsx`) is not wired: the API is ready
  (`POST .../intake` with `{statusToken}` to start, `{statusToken, answer}` to reply).
- Could not run `tsc`/`vitest`/`prisma generate` here (no `node_modules`, no network). Run `npm i && npx prisma generate && npm run typecheck && npm test`.
