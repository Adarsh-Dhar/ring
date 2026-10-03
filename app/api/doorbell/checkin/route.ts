import { NextRequest, NextResponse } from 'next/server'
import { checkIn } from '@/lib/doorbell/store'
import { authorize } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'resident')
  if (a.ok === false) return a.res
  const householdId = a.session!.householdId
  await checkIn(householdId)
  return NextResponse.json({ ok: true })
}
