import { NextRequest, NextResponse } from 'next/server'
import { checkIn } from '@/lib/doorbell/store'
import { authorize, fail } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'resident')
  if (a.ok === false) return a.res

  try {
    await checkIn(a.session!.householdId)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[DOORBELL CHECKIN]', e)
    return fail(`Failed to record check-in: ${msg}`, 503)
  }

  return NextResponse.json({ ok: true })
}
