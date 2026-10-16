AI agents: wiring guide
Put this file at `docs/AI_WIRING.md`. It lists every code change needed to take the `agents/` folder in your latest `ring-main.zip` and make it a working part of the app.
Verification note. This guide comes from reading the code and diffing `agents/` against your root tree. I did not compile or run the `agents/` code, and `agents/docs/AI_AGENTS.md` says the same about itself. Run the checks in section 8 before you trust it.
1. Where things stand
`agents/` is an overlay: new files, plus full copies of five existing files that already contain the integration lines. Nothing in it has been merged into the real tree yet.
Piece
Status in your latest zip
`prisma/schema.prisma` (root)
Already merged. Identical to `agents/prisma/schema.prisma`.
Migration SQL
Only in `agents/prisma/migrations/…`. Not in `prisma/migrations`.
`lib/ai/*`, `app/api/ai/*`, UI components, tests
Only under `agents/`.
Hook in `lib/doorbell/store.ts`
Only in the `agents/` copy.
AI jobs in `lib/queue/jobs.ts`
Only in the `agents/` copy.
Worker registration in `workers/timer-worker.ts`
Only in the `agents/` copy.
Helper / resident / sim page wiring
Only in the `agents/` copies.
`app/api/visit-requests/public/[token]/route.ts`
Deleted from your root. Must be restored (section 3).
`.env.example` AI variables
Missing (section 6).
Visitor screen for intake questions
Not built (section 5.1).
Helper display of the visit-request AI note
Not built (section 5.2).
Helper screen to write resident messages
Not built (section 5.3).
Guardian AI on/off screen and digest list
Not built (section 5.4).
2. Change list (every file)
2.1 New files: copy as-is
Copy from
To
`agents/lib/ai/**` (agents, prompts, talkback, budget, client, guard, hooks, models, runs, schemas, tts, workers, caseAi)
`lib/ai/`
`agents/app/api/ai/**` (cases/[id], describe, digests, digests/run, interrogator/audio, interrogator/script, kill, notes, notes/[id]/decision, notes/current, usage)
`app/api/ai/`
`agents/app/api/visit-requests/public/[token]/intake/**`
`app/api/visit-requests/public/[token]/intake/`
`agents/app/helper/AiCaseCard.tsx`
`app/helper/AiCaseCard.tsx`
`agents/app/resident/ApprovedNote.tsx`
`app/resident/ApprovedNote.tsx`
`agents/app/sim/AiSimTools.tsx`
`app/sim/AiSimTools.tsx`
`agents/prisma/migrations/20261015000000_ai_agents/`
`prisma/migrations/20261015000000_ai_agents/`
`agents/tests/ai-core.test.ts`
`tests/ai-core.test.ts`
`agents/docs/AI_AGENTS.md`
`docs/AI_AGENTS.md`
2.2 Existing files you must edit (7 small edits)
File
Change
`lib/queue/jobs.ts`
Add 4 job names and 3 job types
`lib/doorbell/store.ts`
Add a 2-line fire-and-forget hook in `ingestEvent`
`workers/timer-worker.ts`
Register the AI workers (3 lines)
`app/helper/page.tsx`
Import and render `AiCaseCard`
`app/resident/page.tsx`
Import and render `ApprovedNote`
`app/sim/page.tsx`
Import and render `AiSimTools`
`app/api/visit-requests/public/[token]/route.ts`
Restore the deleted file
You can copy the five `agents/` versions of the first six files, or paste the snippets in section 4. Copying is only safe if those files have not changed in your tree since the overlay was made. Check with `diff` first.
2.3 Gaps: code you still have to write (section 5)
Visitor-side intake question step.
Show the visit-request AI note to helpers.
Helper screen for "messy note → resident sentence".
Guardian AI on/off switch and weekly digest list (curl works until then).
3. Quick path (shell)
Run from the repo root. The old zip is the earlier upload `ring-main__1_.zip`.
git checkout -b ai-agents

# 1. Restore the visitor-form endpoint that was deleted from the root
unzip -o ../ring-main__1_.zip "ring-main/app/api/visit-requests/public/*" -d /tmp/old
cp -r "/tmp/old/ring-main/app/api/visit-requests/public" app/api/visit-requests/

# 2. New files
cp -r agents/lib/ai                      lib/
cp -r agents/app/api/ai                  app/api/
cp -r agents/app/api/visit-requests/public app/api/visit-requests/   # merges intake/ next to the restored route.ts
cp agents/app/helper/AiCaseCard.tsx      app/helper/
cp agents/app/resident/ApprovedNote.tsx  app/resident/
cp agents/app/sim/AiSimTools.tsx         app/sim/
cp -r agents/prisma/migrations/20261015000000_ai_agents prisma/migrations/
cp agents/tests/ai-core.test.ts          tests/
cp agents/docs/AI_AGENTS.md              docs/

# 3. Patched existing files. Check that each diff shows ONLY the AI lines first.
for f in lib/queue/jobs.ts lib/doorbell/store.ts workers/timer-worker.ts \
         app/helper/page.tsx app/resident/page.tsx app/sim/page.tsx; do
  echo "== $f"; diff "$f" "agents/$f"
done
# if the diffs look right:
for f in lib/queue/jobs.ts lib/doorbell/store.ts workers/timer-worker.ts \
         app/helper/page.tsx app/resident/page.tsx app/sim/page.tsx; do
  cp "agents/$f" "$f"
done

# 4. Schema is already merged. This must print nothing:
diff prisma/schema.prisma agents/prisma/schema.prisma

# 5. Remove the overlay so there are no duplicate sources
rm -rf agents
Step 1 matters most: without it, the visitor request form (`/visit/[token]`) returns 404.
4. Exact code changes to existing files
4.1 `lib/queue/jobs.ts`
Add to `JOB_NAMES`:
  AI_INTERROGATOR_START: 'ai-interrogator-start',
  AI_INTAKE_EVAL: 'ai-intake-eval',
  AI_DIGEST_WEEKLY: 'ai-digest-weekly',
Add at the end of the file:
export interface AiCaseJob { householdId: string; caseId: string; deviceId: string | null }
export interface AiIntakeJob { householdId: string; requestId: string }
export interface AiDigestJob { householdId?: string }
`workers/timer-worker.ts` already creates a queue for every value in `JOB_NAMES`, so the new names need no extra setup.
4.2 `lib/doorbell/store.ts`
In `ingestEvent`, right after the `onCameraEvent` line (about line 673), before `return c`:
  const c = await openCase(state, 'visitor', event.event_type, `Ring sent ${event.event_type}.`, event.device_id ?? null, null)
  void import('@/face/camera').then((m) => m.onCameraEvent(householdId, { caseId: c.id, deviceId: event.device_id ?? null })).catch(() => {})
  // AI is advisory: fire-and-forget, never awaited, never on the alert path.
  void import('@/lib/ai/hooks').then((m) => m.onDoorEvent(householdId, { caseId: c.id, deviceId: event.device_id ?? null })).catch(() => {})
  return c
AI results are stored on the `Case` row and read through `/api/ai/cases/[id]`, not through `getState()`. So AI text never reaches the resident view.
4.3 `workers/timer-worker.ts`
Insert just before `console.log('[WORKER] Worker ready, waiting for jobs...')` (about line 92):
  // AI agents (advisory only; a failure here must not stop the worker)
  try { const { registerAiWorkers } = await import('@/lib/ai/workers'); await registerAiWorkers(boss) } catch (e) { console.error('[WORKER] AI workers failed to register', e) }

This also schedules the weekly digest (Monday 03:00 UTC).
4.4 `app/helper/page.tsx`
Add the import near the other component imports:
import AiCaseCard from './AiCaseCard'
Render it right after the `regularId` block (after its closing `)}`, before the "Expected now" paragraph):
          {c.kind === 'visitor' && <AiCaseCard caseId={c.id} />}
4.5 `app/resident/page.tsx`
import ApprovedNote from './ApprovedNote'
Add after the `{screen.sub && …}` line:
        {!c && <ApprovedNote />}
`ApprovedNote` only shows a note a helper approved.
4.6 `app/sim/page.tsx`
import AiSimTools from './AiSimTools'
Add just before the closing `</main>`:
      <AiSimTools caseId={caseId} />
4.7 Restore `app/api/visit-requests/public/[token]/route.ts`
Take it unchanged from the earlier zip (see section 3, step 1). Do not rewrite it. The `intake` routes live in the sub-folder beside it.
5. Code you still need to write
The API for each of these exists. Only the screen is missing.
5.1 Visitor intake step (follow-up questions)
The intake API needs both the link token and the request's `statusToken`: `POST /api/visit-requests/public/{linkToken}/intake` with `{ statusToken }` to start, or `{ statusToken, answer }` to reply. The status page `/visit/s/[statusToken]` does not know the link token, so the questions must be asked on the form page, between submit and the redirect.
New file `app/visit/[token]/IntakeStep.tsx`:
'use client'

import { useEffect, useState } from 'react'

/** Follow-up questions after a visit request. Fail-open: any error calls onDone() and the flow continues as before. */
export default function IntakeStep({ token, statusToken, onDone }: { token: string; statusToken: string; onDone: () => void }) {
  const [q, setQ] = useState<string | null>(null)
  const [a, setA] = useState('')
  const [busy, setBusy] = useState(true)

  const call = async (answer?: string) => {
    setBusy(true)
    try {
      const r = await fetch(`/api/visit-requests/public/${token}/intake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(answer === undefined ? { statusToken } : { statusToken, answer }),
      })
      const j = r.ok ? await r.json() : { question: null, done: true }
      if (j.done || !j.question) { onDone(); return }
      setQ(j.question); setA('')
    } catch { onDone(); return }
    setBusy(false)
  }

  useEffect(() => { void call() /* eslint-disable-next-line */ }, [])

  if (!q) return <main className="min-h-screen bg-slate-900 text-white flex items-center justify-center"><p>One moment…</p></main>

  return (
    <main className="min-h-screen bg-slate-900 text-white p-6 max-w-lg mx-auto flex flex-col justify-center gap-4">
      <p className="text-slate-400 text-sm">One quick question to help the helpers decide:</p>
      <h1 className="text-xl font-semibold">{q}</h1>
      <input value={a} onChange={e => setA(e.target.value)} maxLength={300}
        className="w-full rounded-xl bg-slate-700 px-4 py-3 text-white" placeholder="Your answer" />
      <button disabled={busy || !a.trim()} onClick={() => call(a)}
        className="rounded-xl bg-cyan-600 py-3 font-semibold disabled:opacity-40">{busy ? 'Sending…' : 'Send answer'}</button>
      <button onClick={onDone} className="text-sm text-slate-400">Skip</button>
    </main>
  )
}
Edit `app/visit/[token]/page.tsx`:
`import IntakeStep from './IntakeStep'`
Add `'intake'` to the `PageState` union.
Add state: `const [statusToken, setStatusToken] = useState('')`
In `submit`, replace `router.push(\`/visit/s/${j.statusToken}\)` with:
setStatusToken(j.statusToken)setPageState('intake')
Before the `'loading'` early return, add:
if (pageState === 'intake') {  return <IntakeStep token={token} statusToken={statusToken} onDone={() => router.push(`/visit/s/${statusToken}`)} />}
When AI is off the API returns `{ question: null, done: true }`, so the visitor goes straight to the status page, exactly as today.
5.2 Show the AI note on visit requests (helpers only)
`agents/lib/ai/agents/intake.ts` writes `VisitRequest.riskNote`, but no screen shows it.
In `app/api/visit-requests/route.ts`, in the `shape` function, add:
    riskNote:    r.riskNote ?? null,   // AI note, helpers only
and in the resident branch change the map to:
        .map(r => ({ ...shape(r), note: null, riskNote: null })),
In `app/helper/VisitRequests.tsx`, add `riskNote?: string | null` to the `VisitReq` interface, then render it under the `r.note` line:
              {r.riskNote && <p className="mt-2 rounded-lg bg-slate-900 px-2 py-1 text-xs text-amber-200">{r.riskNote} <span className="text-slate-400">(AI, may be wrong)</span></p>}
5.3 Helper screen for resident messages
API shapes:
- `POST /api/ai/notes` with `{ note }` returns `{ draft: { id, text, icon, fallback } }`.
- `POST /api/ai/notes/[id]/decision` with `{ action: 'approve' | 'reject', text?, icon? }`.
Create `app/helper/NoteComposer.tsx`, render `<NoteComposer />` next to `<VisitRequests … />` in `app/helper/page.tsx`:
'use client'

import { useState } from 'react'
import { PURPOSES } from '@/lib/doorbell/purposes'

export default function NoteComposer() {
  const [raw, setRaw] = useState('')
  const [draft, setDraft] = useState<{ id: string; text: string; icon: string; fallback: boolean } | null>(null)
  const [text, setText] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const make = async () => {
    setBusy(true); setMsg('')
    const r = await fetch('/api/ai/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: raw }) })
    const j = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) { setMsg(j.error || 'Could not make a draft.'); return }
    setDraft(j.draft); setText(j.draft.text)
  }

  const decide = async (action: 'approve' | 'reject') => {
    if (!draft) return
    const r = await fetch(`/api/ai/notes/${draft.id}/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...(action === 'approve' ? { text } : {}) }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setMsg(j.error || 'Could not save.'); return }
    setMsg(action === 'approve' ? 'Now showing on the resident screen.' : 'Discarded.')
    setDraft(null); setRaw('')
  }

  return (
    <section className="mb-6">
      <h2 className="text-sm uppercase tracking-wide text-slate-400 mb-3">Message for the resident</h2>
      <div className="rounded-2xl bg-slate-800 p-4 space-y-3">
        <textarea value={raw} onChange={e => setRaw(e.target.value)} maxLength={400} rows={2}
          placeholder="e.g. Dr Rao can't come, her colleague Mark is coming at 3 instead."
          className="w-full rounded-xl bg-slate-700 px-3 py-2 text-white" />
        <button onClick={make} disabled={busy || raw.trim().length < 2} className="w-full rounded-xl bg-cyan-600 py-3 font-semibold disabled:opacity-40">
          {busy ? 'Writing…' : 'Make it short and simple'}
        </button>
        {draft && (
          <div className="rounded-xl bg-slate-900 p-3 space-y-2">
            <p className="text-xs text-slate-400">Draft{draft.fallback ? ' (AI unavailable: check the wording)' : ''}. The resident cannot see it yet.</p>
            <div className="flex items-center gap-2">
              <span className="text-3xl">{(PURPOSES as any)[draft.icon]?.icon ?? '👤'}</span>
              <input value={text} onChange={e => setText(e.target.value)} className="flex-1 rounded-lg bg-slate-700 px-3 py-2 text-lg" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => decide('approve')} className="rounded-xl bg-emerald-700 py-2 font-semibold">Show to resident</button>
              <button onClick={() => decide('reject')} className="rounded-xl bg-slate-700 py-2">Discard</button>
            </div>
          </div>
        )}
        {msg && <p className="text-sm text-slate-300">{msg}</p>}
      </div>
    </section>
  )
}
5.4 Guardian switch and digests (no UI yet)
The household flags default to off. Until you build a Setup toggle, turn them on while signed in as a guardian, from the browser console:
await fetch('/api/ai/kill', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ aiEnabled: true, aiInterrogator: true }) }).then(r => r.json())
Useful reads and actions:
- `GET /api/ai/digests` lists past digests.
- `POST /api/ai/digests/run` with `{ "force": false }` makes one now.
- `GET /api/ai/usage` shows the last 24 hours of AI calls.
There is no endpoint that reads the current flags, so a proper toggle also needs a small `GET /api/ai/kill` (return `{ aiEnabled, aiInterrogator }` from `Household`).
6. Environment variables
Add to `.env.example` and `.env.prod.example`. `lib/env-validate.ts` already knows the Gemini ones.
# ───── AI agents (all optional; AI is OFF per household until a guardian switches it on) ─────
GEMINI_API_KEY=
GEMINI_MODEL_WORKHORSE=gemini-3.1-flash-lite   # audio, image, short text
GEMINI_MODEL_QUALITY=gemini-3.8-flash          # weekly digest
GEMINI_MODEL_FALLBACK=gemma-4-26b              # text-only fallback (never used for audio/images)
GEMINI_MODEL_EMBEDDING=gemini-embedding-2
GEMINI_MODEL_TTS=gemini-3.1-flash-tts
# Optional quota overrides, per role (defaults match your AI Studio table):
# GEMINI_LIMIT_WORKHORSE_RPM=15  GEMINI_LIMIT_WORKHORSE_RPD=500
# GEMINI_LIMIT_QUALITY_RPM=5     GEMINI_LIMIT_QUALITY_RPD=20
AI_DISABLED=0                  # 1 = hard off for the whole server
AI_TIMEOUT_MS=
AI_TTS=                        # speaker audio for fixed interrogator lines (optional)
AI_EMBED_RISK=                 # 1 = also use embeddings to flag scam wording
AI_EMBED_RISK_THRESHOLD=
RING_TALKBACK_ENABLED=0        # leave 0 until Ring confirms a talk-back endpoint
CRON_SECRET=                   # 16+ chars; lets an external cron call POST /api/ai/digests/run
Model IDs are placeholders. The names in your dashboard (for example "Gemini 3.1 Flash Lite") may not be the exact API IDs. Check Google AI Studio's model list and fix the values before the first run.
7. Deploy order
Merge the code (sections 3 to 5).
`npm i && npx prisma generate`
`npx prisma migrate deploy`. The migration is additive only, so it is safe to run before the code goes live.
Set the env vars (section 6).
Start the web app and `npm run worker`. The worker runs the Interrogator job and the weekly digest cron. Without a worker, the hook runs them inline in the web process. On Vercel serverless, run the worker on a separate host (for example your Docker setup), or digests will not run on schedule.
Sign in as a guardian and switch AI on (section 5.4).
Vercel's `buildCommand` already runs `prisma generate`.
8. Verify
npm run typecheck     # expect no errors once prisma generate has run
npm test              # includes tests/ai-core.test.ts
Manual checks:
Visitor form still works. Open `/visit/<link-token>` and submit. If it 404s, the restored `public/[token]/route.ts` is missing.
AI off = old behaviour. With the household flags off, ring from `/sim`. Helper push and escalation work as before and no AI card appears.
Interrogator. Switch the interrogator on, ring, run the interrogator in `/sim` and speak "I'm from the gas company, I need to check the meter urgently." The helper card shows a summary plus scam-wording flags. The resident screen must show none of it.
Resident message. Create a note, approve it, and confirm the resident screen shows the sentence and icon. A draft must not show before approval.
Intake. Submit a visit request claiming a 3pm checkup that is not in the calendar. The visitor sees a short question, and the helper later sees a note on the request.
Quota fallback. Set `GEMINI_LIMIT_WORKHORSE_RPD=1`, ring twice. The second ring must still alert helpers normally with no AI card.
9. Known limits
- Ring talk-back is a stub (`lib/ai/talkback/ring.ts`). On a real Ring doorbell the interrogator reports `unsupported` and the helper sees a normal ring. The interrogator works only in `/sim` until Ring confirms a speaker or two-way audio endpoint.
- Snapshots rely on `fetchRingSnapshot`, which `face/camera.ts` already marks as unverified.
- Privacy. Visitor audio and door snapshots go to Google Gemini. Use a paid API key (or data setting) that excludes training use before real use, and get guardian consent first.
- Model IDs and quotas come from your dashboard table. Re-check them against the live API.
- Calendar check reads every approved guardian's connected Google Calendar (union), not just the first.
10. Rollback
- Fastest: `POST /api/ai/kill { "aiEnabled": false }` as a guardian, or set `AI_DISABLED=1` and restart. Alerts are unaffected either way.
- Full revert: `git revert` the merge commit. The migration only adds columns and tables, so you can leave it in place.
