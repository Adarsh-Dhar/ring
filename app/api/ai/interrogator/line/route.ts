import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail, parse } from '@/lib/guard'
import { hit } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { getDb } from '@/lib/db/client'
import { aiFlags } from '@/lib/ai/caseAi'
import { isUnplannedVisit } from '@/lib/ai/interrogation/gate'
import { isHoldingCaseFor } from '@/lib/doorstep/holdState'
import { dispatchAiAction } from '@/lib/doorstep/toolDispatcher'
import { cachedLineAudio } from '@/lib/ai/tts'

const Body = z.object({
  caseId: z.string().min(1).max(80),
  line: z.enum(['greet', 'reprompt', 'close', 'rules_explained', 'boundary_stated', 'asked_to_leave', 'entry_not_permitted', 'safety', 'emergency_guidance', 'holding']),
})

/**
 * The ONLY way a device or the simulator gets a fixed line. The dispatcher gates it (spec 5.4), audits the allow or
 * refusal, and on allow writes the interview stamp the line stands for. A refused line is never returned.
 * Call this immediately before playing the line: the stamp means "this was sent to the door".
 */
export async function POST(req: NextRequest) {
  const a = await authorize(req, 'device', 'helper')
  if (a.ok === false) return a.res
  const householdId = a.session.householdId
  if (!householdId) return fail('No household', 400)
  if (!hit(`ai:line:${householdId}`, 60, 60_000)) return fail('Too many requests', 429)

  const p = await parse(req, Body)
  if (p.ok === false) return p.res
  const f = await aiFlags(householdId)
  if (!f.aiEnabled || !f.aiInterrogator) return NextResponse.json({ allowed: false, reason: 'ai_off', text: null, audio: null })

  const c = await getDb().case.findFirst({
    where: { id: p.data.caseId, householdId },
    select: { id: true, kind: true, lane: true, expectedId: true, recurringId: true, noticeStatus: true, status: true },
  })
  if (!c) return fail('Case not found', 404)
  // Only unplanned visits are interviewed. A short-notice case waiting for approval may still get its (zero-cost) holding line.
  if (!isUnplannedVisit(c) && !(await isHoldingCaseFor(householdId, c))) return fail('The AI does not speak on planned visits', 409)

  const d = await dispatchAiAction({ householdId, caseId: c.id, line: p.data.line, residentName: f.residentName })
  const audio = d.allowed && d.text ? await cachedLineAudio(householdId, p.data.line, d.text).catch(() => null) : null
  return NextResponse.json({ allowed: d.allowed, reason: d.reason, text: d.text, audio })
}
