import { NextRequest, NextResponse } from 'next/server'
import { getHistory } from '@/lib/doorbell/store'
import { authorize, fail } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res

  let history: Awaited<ReturnType<typeof getHistory>>
  try {
    history = await getHistory(a.session!.householdId)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[DOORBELL HISTORY]', e)
    return fail(`Failed to load doorbell history: ${msg}`, 503)
  }

  return NextResponse.json(history)
}
