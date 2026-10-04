import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { answerCase } from '@/lib/doorbell/store'
import { authorize, fail, parse } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const Body = z.object({
  caseId:  z.string().min(1).max(80),
  answer:  z.enum(['safe', 'not_safe', 'call_me']),
  visitor: z.enum(['known', 'delivery', 'unknown']).optional(),
})

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'helper')
  if (a.ok === false) return a.res

  const p = await parse(req, Body)
  if (p.ok === false) return p.res

  const { caseId, answer, visitor } = p.data

  if (answer === 'safe' && visitor !== 'known' && visitor !== 'delivery') {
    return fail('Please identify who is at the door (known person or delivery) before marking as safe.', 400)
  }

  const householdId  = a.session!.householdId
  const membershipId = a.session!.membershipId!

  let r: Awaited<ReturnType<typeof answerCase>>
  try {
    r = await answerCase(householdId, caseId, membershipId, answer, visitor)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[DOORBELL ANSWER]', e)
    return fail(`Failed to submit answer: ${msg}`, 503)
  }

  if (r.ok === false) return fail(r.error, r.status)
  return NextResponse.json({ ok: true })
}
