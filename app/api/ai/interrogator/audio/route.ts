import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail, parse } from '@/lib/guard'
import { hit } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { getDb } from '@/lib/db/client'
import { processAnswer } from '@/lib/ai/agents/interrogator'
import { aiFlags } from '@/lib/ai/caseAi'
import { interrogatorLines } from '@/lib/ai/talkback'
import { isUnplannedVisit } from '@/lib/ai/interrogation/gate'
import { applyRiskEdit } from '@/lib/doorstep/caseRiskStore'

const Body = z.object({
  caseId:   z.string().min(1).max(80),
  audio:    z.string().min(100).max(1_500_000),                     // base64, ~1 MB
  mimeType: z.enum(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/aac']),
})

/** Mark the microphone unavailable on the current case — fire-and-forget. */
function markMicUnavailable(caseId: string, reason: string) {
  applyRiskEdit(caseId, {
    kind: 'availability', device: 'mic', available: false,
    since: new Date().toISOString(), reason,
  }).catch(e => console.error('[AUDIO] mic availability mark failed', e))
}

/** The device (or /sim) uploads the visitor's recorded reply. Updates the Case; never touches escalation. */
export async function POST(req: NextRequest) {
  const a = await authorize(req, 'device', 'helper', 'guardian')
  if (a.ok === false) return a.res
  const householdId = a.session.householdId
  if (!householdId) return fail('No household', 400)
  if (!hit(`ai:audio:${householdId}`, 20, 60_000)) return fail('Too many requests', 429)

  const p = await parse(req, Body)
  if (p.ok === false) return p.res
  const f = await aiFlags(householdId)
  if (!f.aiEnabled || !f.aiInterrogator) return fail('AI interrogator is off', 409)

  // Server-side gate: re-check the case
  const c = await getDb().case.findFirst({
    where: { id: p.data.caseId, householdId },
    select: { id: true, kind: true, lane: true, expectedId: true, recurringId: true, interrogationState: true },
  })
  if (!c) return fail('Case not found', 404)
  if (!isUnplannedVisit(c)) return fail('Interrogation is only for unplanned visits', 409)

  // If the interrogator is already in a failed/unsupported state, mark mic unavailable and return.
  if (c.interrogationState === 'failed' || c.interrogationState === 'unsupported') {
    markMicUnavailable(c.id, `Interrogation state: ${c.interrogationState}`)
    return fail('Interrogation is not active', 409)
  }

  // Reject empty audio before passing to the model (saves a round-trip and marks mic unavailable).
  const audioBuf = Buffer.from(p.data.audio, 'base64')
  if (audioBuf.length < 100) {
    markMicUnavailable(c.id, 'Empty or near-empty audio received')
    return NextResponse.json({ question: null, final: true, close: interrogatorLines(f.residentName).close })
  }

  const r = await processAnswer(householdId, c.id, audioBuf, p.data.mimeType)

  // If processAnswer returned final without a question, it means the transcription or model failed.
  // Mark the mic unavailable so the helper sees it in the Unknown group.
  if (r.final && !r.question) {
    markMicUnavailable(c.id, 'Transcription or model failure during audio processing')
  }

  return NextResponse.json({
    question: r.question,
    final: r.final,
    close: r.final ? interrogatorLines(f.residentName).close : null,
    // transcript, claims, verdict, flags are NOT returned to the device: the visitor side never learns what was understood
  })
}
