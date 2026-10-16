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

const Body = z.object({
  caseId:   z.string().min(1).max(80),
  audio:    z.string().min(100).max(1_500_000),                     // base64, ~1 MB
  mimeType: z.enum(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/aac']),
})

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
    select: { id: true, kind: true, lane: true, expectedId: true, recurringId: true },
  })
  if (!c) return fail('Case not found', 404)
  if (!isUnplannedVisit(c)) return fail('Interrogation is only for unplanned visits', 409)

  const buf = Buffer.from(p.data.audio, 'base64')
  const r = await processAnswer(householdId, c.id, buf, p.data.mimeType)
  return NextResponse.json({
    question: r.question,
    final: r.final,
    close: r.final ? interrogatorLines(f.residentName).close : null,
    // transcript, claims, verdict, flags are NOT returned to the device: the visitor side never learns what was understood
  })
}
