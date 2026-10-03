// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { answerCase } from '@/lib/doorbell/store'
import { authorize, fail, parse } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const Body = z.object({
  caseId: z.string().max(80),
  answer: z.enum(['safe', 'not_safe', 'call_me']),
  visitor: z.enum(['known', 'delivery', 'unknown']).optional(),
})

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'helper')
  if (!a.ok) return a.res
  const p = await parse(req, Body)
  if (!p.ok) return p.res
  const { caseId, answer, visitor } = p.data
  if (answer === 'safe' && visitor !== 'known' && visitor !== 'delivery') return fail('Say who is at the door before marking safe')
  const householdId = a.session!.householdId
  const membershipId = a.session!.membershipId!
  const r = await answerCase(householdId, caseId, membershipId, answer, visitor)
  if (!r.ok) return fail(r.error, r.status)
  return NextResponse.json({ ok: true })
}
