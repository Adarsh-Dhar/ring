import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail, parse } from '@/lib/guard'
import { hit } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { runDigest } from '@/lib/ai/agents/digest'
import { aiFlags } from '@/lib/ai/caseAi'
import { timingSafeEqual } from 'crypto'

const Body = z.object({ householdId: z.string().max(80).optional(), force: z.boolean().default(false) })

const cronOk = (req: NextRequest) => {
  const secret = process.env.CRON_SECRET
  const got = req.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
  if (!secret || secret.length < 16 || got.length !== secret.length) return false
  return timingSafeEqual(new Uint8Array(Buffer.from(got)), new Uint8Array(Buffer.from(secret)))
}

export async function POST(req: NextRequest) {
  let householdId: string | undefined
  let force = false
  if (cronOk(req)) {
    const b = await req.json().catch(() => ({})); householdId = b?.householdId
    if (!householdId) return fail('householdId required for cron', 400)
  } else {
    const a = await authorize(req, 'helper')
    if (a.ok === false) return a.res
    householdId = a.session.householdId
    const p = await parse(req, Body.partial())
    if (p.ok === false) return p.res
    force = !!p.data.force
  }
  if (!householdId) return fail('No household', 400)
  if (!hit(`ai:digest:${householdId}`, 3, 60 * 60_000)) return fail('Too many requests', 429)
  const f = await aiFlags(householdId)
  if (!f.aiEnabled) return fail('AI is off', 409)
  const d = await runDigest(householdId, new Date(), force)
  return NextResponse.json({ digest: { id: d.id, weekStart: d.weekStart, text: d.text, facts: d.facts } })
}
