// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server'
import { raiseSos } from '@/lib/doorbell/store'
import { authorize } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'resident')
  if (!a.ok) return a.res
  const householdId = a.session!.householdId
  const c = await raiseSos(householdId)
  return NextResponse.json({ ok: true, caseId: c.id })
}
