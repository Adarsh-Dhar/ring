import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { selfVerify } from '@/lib/doorbell/store'
import { authorize, parse } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const Body = z.object({
  caseId: z.string().max(80),
  ok:     z.boolean(),
})

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'resident')
  if (a.ok === false) return a.res
  const p = await parse(req, Body)
  if (p.ok === false) return p.res

  const householdId = a.session!.householdId
  const result = await selfVerify(householdId, p.data.caseId, p.data.ok)

  if (!result) {
    return NextResponse.json({ error: 'nothing to check' }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
