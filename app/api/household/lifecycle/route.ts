import { NextRequest, NextResponse } from 'next/server'
import { authorize, fail } from '@/lib/guard'
import { getLifecyclePolicy, setLifecyclePolicy, QUIET_MINUTES_RANGE, LOOKBACK_HOURS_RANGE } from '@/lib/doorstep/lifecyclePolicy'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** GET /api/household/lifecycle: the resident-set quiet period and look-back window (section 8.2). */
export async function GET(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res
  return NextResponse.json(await getLifecyclePolicy(a.session!.householdId!), { headers: { 'Cache-Control': 'no-store' } })
}

/** PUT /api/household/lifecycle  Body: { quietMinutes?, lookbackHours? }. Out-of-range values are rejected, not clamped. */
export async function PUT(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res
  let body: any
  try { body = await req.json() } catch { return fail('Request body must be valid JSON', 400) }
  const inRange = (v: unknown, r: { min: number; max: number }) => typeof v === 'number' && Number.isInteger(v) && v >= r.min && v <= r.max
  if (body?.quietMinutes !== undefined && !inRange(body.quietMinutes, QUIET_MINUTES_RANGE)) return fail(`quietMinutes must be a whole number from ${QUIET_MINUTES_RANGE.min} to ${QUIET_MINUTES_RANGE.max}`, 400)
  if (body?.lookbackHours !== undefined && !inRange(body.lookbackHours, LOOKBACK_HOURS_RANGE)) return fail(`lookbackHours must be a whole number from ${LOOKBACK_HOURS_RANGE.min} to ${LOOKBACK_HOURS_RANGE.max}`, 400)
  try {
    return NextResponse.json(await setLifecyclePolicy(a.session!.householdId!, { quietMinutes: body?.quietMinutes, lookbackHours: body?.lookbackHours }), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[LIFECYCLE SETTINGS]', e)
    return fail('Could not save lifecycle settings', 503)
  }
}
