import { NextRequest, NextResponse } from 'next/server'
import { getState } from '@/lib/doorbell/store'
import { authorize, fail } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const a = await authorize(req, 'helper', 'resident')
  if (a.ok === false) return a.res

  const s            = a.session!
  const householdId  = s.householdId
  const membershipId = s.membershipId
  const view         = s.kind === 'resident' ? 'resident' : 'helper'

  let state: Awaited<ReturnType<typeof getState>>
  try {
    state = await getState(householdId, view, membershipId)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[DOORBELL STATE]', e)
    return fail(`Failed to load doorbell state: ${msg}`, 503)
  }

  if (!state) {
    return fail('Household not found. It may have been deleted.', 404)
  }

  return NextResponse.json(state, { headers: { 'Cache-Control': 'no-store' } })
}
