import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail, parse } from '@/lib/guard'
import { hit } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { getDb } from '@/lib/db/client'
import { processReply } from '@/lib/ai/agents/greeter'
import { aiFlags } from '@/lib/ai/caseAi'
import { greeterLines } from '@/lib/ai/talkback'

const Body = z.object({
  caseId:   z.string().min(1).max(80),
  audio:    z.string().min(100).max(1_500_000),                     // base64, ~1 MB
  mimeType: z.enum(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/aac']),
  lastTry:  z.boolean().default(false),
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
  if (!f.aiEnabled || !f.aiGreeter) return fail('AI greeter is off', 409)

  const c = await getDb().case.findFirst({ where: { id: p.data.caseId, householdId }, select: { id: true } })
  if (!c) return fail('Case not found', 404)

  const buf = Buffer.from(p.data.audio, 'base64')
  const r = await processReply(householdId, c.id, buf, p.data.mimeType, p.data.lastTry)
  return NextResponse.json({
    final: r.final,
    reprompt: r.reprompt ? greeterLines(f.residentName).reprompt : null,
    close: r.final ? greeterLines(f.residentName).close : null,
    // transcript / summary are NOT returned to the device: the visitor side never learns what was understood
  })
}
