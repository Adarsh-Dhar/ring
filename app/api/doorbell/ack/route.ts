import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ackCase } from '@/lib/doorbell/store'
import { authorize, fail, parse } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** "I have seen this alert." The resident screen only says help is coming after this. */
export async function POST(req: NextRequest) {
  const a = await authorize(req, 'helper')
  if (a.ok === false) return a.res
  const p = await parse(req, z.object({ caseId: z.string().max(80) }))
  if (p.ok === false) return p.res
  const householdId = a.session!.householdId
  const membershipId = a.session!.membershipId!
  const r = await ackCase(householdId, p.data.caseId, membershipId)
  if (r.ok === false) return fail(r.error, r.status)
  return NextResponse.json({ ok: true })
}
