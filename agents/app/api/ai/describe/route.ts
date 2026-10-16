import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail, parse } from '@/lib/guard'
import { hit } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { describeSnapshot } from '@/lib/ai/agents/describer'
import { getDb } from '@/lib/db/client'
import { aiFlags } from '@/lib/ai/caseAi'

const Body = z.object({
  caseId:   z.string().min(1).max(80).optional(),
  image:    z.string().min(100).max(5_000_000),     // base64
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']).default('image/jpeg'),
})

/** For /sim and tests: describe an uploaded image. Real rings are described by the AI_DESCRIBE job. */
export async function POST(req: NextRequest) {
  const a = await authorize(req, 'helper', 'guardian', 'device')
  if (a.ok === false) return a.res
  const householdId = a.session.householdId
  if (!householdId) return fail('No household', 400)
  if (!hit(`ai:describe:${householdId}`, 10, 60_000)) return fail('Too many requests', 429)
  const p = await parse(req, Body)
  if (p.ok === false) return p.res
  const f = await aiFlags(householdId)
  if (!f.aiEnabled) return fail('AI is off', 409)
  let caseId: string | null = null
  if (p.data.caseId) {
    const c = await getDb().case.findFirst({ where: { id: p.data.caseId, householdId }, select: { id: true } })
    if (!c) return fail('Case not found', 404)
    caseId = c.id
  }
  const r = await describeSnapshot(householdId, caseId, Buffer.from(p.data.image, 'base64'), p.data.mimeType)
  return NextResponse.json({ result: r, label: 'AI description, may be wrong' })
}
