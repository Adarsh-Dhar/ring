import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { selfVerify } from '@/lib/doorbell/store'
import { authorize, fail, parse } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const Body = z.object({
  caseId: z.string().min(1).max(80),
  ok:     z.boolean(),
})

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'resident')
  if (a.ok === false) return a.res

  const p = await parse(req, Body)
  if (p.ok === false) return p.res

  let result: Awaited<ReturnType<typeof selfVerify>>
  try {
    result = await selfVerify(a.session!.householdId, p.data.caseId, p.data.ok)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[DOORBELL VERIFY]', e)
    return fail(`Failed to submit verification: ${msg}`, 503)
  }

  if (!result) {
    return fail('No active case to verify. The case may have already been resolved.', 404)
  }

  return NextResponse.json({
    ok:    true,
    retry: result.status === 'waiting' && result.lane === 'expected',
  })
}
