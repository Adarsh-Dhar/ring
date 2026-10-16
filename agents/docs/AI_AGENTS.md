# AI agents

Five advisory agents. **None of them is on the alert path**: the helper push/SMS, escalation timer and resident
screen behave exactly as before if AI is off, slow, over quota or wrong.

## Turn it on
1. `npx prisma migrate deploy` (migration `20261015000000_ai_agents`, additive only).
2. Set `GEMINI_API_KEY` and the model IDs in `.env` (see `.env.example`).
3. Guardian: `POST /api/ai/kill {"aiEnabled": true, "aiGreeter": true}` (both default to **false** per household).
4. Run the worker (`npm run worker`) so the jobs and the weekly digest cron run. Without a worker, the hook runs the describer/greeter inline.

## Agents
| Agent | Model role | Trigger | Output (who sees it) |
|---|---|---|---|
| Describer | workhorse (vision) | ring (`AI_DESCRIBE` job) or `POST /api/ai/describe` | ≤15-word clothing/object description + tags → helper |
| Door Greeter | workhorse (audio) | ring (`AI_GREETER_START`), reply via `POST /api/ai/greeter/audio` | one-line visitor summary + risk flags → helper |
| Note Compressor | workhorse → Gemma fallback | `POST /api/ai/notes` | ≤8-word sentence + icon; **resident sees it only after helper approval** |
| Visit Intake | workhorse (text) | `POST /api/visit-requests/public/[token]/intake` | verdict note on the VisitRequest → helper |
| Digest | quality | weekly cron / `POST /api/ai/digests/run` | ~80-word weekly summary → guardian |

## Safety rules (enforced in code, covered by `tests/ai-core.test.ts`)
- The doorbell only ever says 3 fixed lines (`lib/ai/talkback/lines.ts`). Models never generate speech.
- Visitor/calendar/helper text is wrapped in `<untrusted_data>` blocks and sanitised; it never reaches the instruction part of a prompt.
- Every model output is zod-validated, word-clamped and checked against banned phrases; failure ⇒ "no AI result".
- Intake: the LLM only extracts claims and words one ≤20-word question. Calendar/known-visit lookups are done by code
  (±2h of the claimed time, minimal fields) and the verdict is computed deterministically. The visitor is never told
  what is or isn't expected. Calendar text is never sent to the model.
- Risk flags are regex (+ optional embedding similarity) and are helper-only.
- Budgets (`lib/ai/budget.ts`) are per model RPM/RPD in Redis (in-memory fallback). Out of budget ⇒ degrade, never error.
- Audio/images never fall back to the text-only Gemma model.
- Every call is logged to `AiRun`; `GET /api/ai/usage` shows the last 24h.

## Not done / needs your input
- **Ring talk-back**: `lib/ai/talkback/ring.ts` is a stub. No speaker/two-way audio endpoint is verified in
  `lib/ring/client.ts`. Until implemented, real rings set `greeterState = 'unsupported'`; the greeter works in `/sim`.
- **Snapshot**: `fetchRingSnapshot` is already marked UNVERIFIED in `face/camera.ts`; the Describer inherits that.
- **Model IDs** are placeholders (could not be verified as API IDs). Set them in `.env`.
- **Calendar owner**: intake checks *every* approved guardian who connected Google Calendar (union).
- **Privacy**: free-tier Gemini data may be used for training. Use a paid key before sending real door audio/images.
- Visitor UI for the intake questions (`app/visit/[token]/page.tsx`) is not wired: the API is ready
  (`POST .../intake` with `{statusToken}` to start, `{statusToken, answer}` to reply).
- Could not run `tsc`/`vitest`/`prisma generate` here (no `node_modules`, no network). Run `npm i && npx prisma generate && npm run typecheck && npm test`.
