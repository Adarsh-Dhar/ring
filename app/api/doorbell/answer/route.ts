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
  const a = authorize(req, 'helper')
  if (!a.ok) return a.res
  const p = await parse(req, Body)
  if (!p.ok) return p.res
  const { caseId, answer, visitor } = p.data
  if (answer === 'safe' && visitor !== 'known' && visitor !== 'delivery') return fail('Say who is at the door before marking safe')
  // The helper is taken from the signed session, never from the request body.
  const helperId = (a.session as { helperId: string }).helperId
  const r = answerCase(caseId, helperId, answer, visitor)
  if (!r.ok) return fail(r.error, r.status)
  return NextResponse.json({ ok: true })
}
