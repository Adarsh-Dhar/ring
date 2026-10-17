import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail, parse } from '@/lib/guard'
import { hit } from '@/lib/ratelimit'
import { getDb } from '@/lib/db/client'
import { processAnswer } from '@/lib/ai/agents/interrogator'
import { aiFlags } from '@/lib/ai/caseAi'
import { interrogatorLines } from '@/lib/ai/talkback'
import { isUnplannedVisit } from '@/lib/ai/interrogation/gate'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const Body = z.object({
  caseId: z.string().min(1).max(80),
  text:   z.string().trim().min(1).max(500),
})

/**
 * Workspace simulator only: the guardian TYPES the visitor's reply instead of speaking it.
 * Same interrogator, same guards, same output as /api/ai/interrogator/audio. Locked to
 * DEMO_MODE and to cases raised by a simulated doorbell (deviceId "sim-…"), so it can never be used
 * to put words in a real visitor's mouth.
 */
export async function POST(req: NextRequest) {
  if (process.env.DEMO_MODE !== '1') return fail('Simulator is disabled. Set DEMO_MODE=1 and restart.', 403)

  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res
  const householdId = a.session.householdId
  if (!householdId) return fail('No household', 400)
  if (!hit(`sim:ai:text:${householdId}`, 20, 60_000)) return fail('Too many requests', 429)

  const p = await parse(req, Body)
  if (p.ok === false) return p.res

  const f = await aiFlags(householdId)
  if (!f.aiEnabled || !f.aiInterrogator) return fail('AI interrogator is off. Turn on AI and the interrogator in Setup → AI Helpers.', 409)

  const c = await getDb().case.findFirst({
    where: { id: p.data.caseId, householdId },
    select: { id: true, kind: true, lane: true, expectedId: true, recurringId: true, deviceId: true },
  })
  if (!c) return fail('Case not found', 404)
  if (!c.deviceId?.startsWith('sim-')) return fail('Typed answers are only allowed on simulated doorbells', 409)
  if (!isUnplannedVisit(c)) return fail('Interrogation is only for unplanned visits', 409)

  const r = await processAnswer(householdId, c.id, p.data.text)
  return NextResponse.json({
    question: r.question,
    final:    r.final,
    close:    r.final ? interrogatorLines(f.residentName).close : null,
    // Like the audio route: transcript, claims, verdict and risk are NOT returned to the visitor side.
  })
}
