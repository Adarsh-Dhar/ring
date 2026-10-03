// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server'
import { getState } from '@/lib/doorbell/store'
import { authorize } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const a = await authorize(req, 'helper', 'resident')
  if (!a.ok) return a.res
  const s = a.session!
  const householdId = s.householdId
  const membershipId = s.membershipId
  const view = s.kind === 'resident' ? 'resident' : 'helper'
  return NextResponse.json(await getState(householdId, view, membershipId), { headers: { 'Cache-Control': 'no-store' } })
}
