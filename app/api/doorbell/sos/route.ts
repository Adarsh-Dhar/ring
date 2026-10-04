import { NextRequest, NextResponse } from 'next/server'
import { raiseSos } from '@/lib/doorbell/store'
import { authorize, fail } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'resident')
  if (a.ok === false) return a.res

  let c: Awaited<ReturnType<typeof raiseSos>>
  try {
    c = await raiseSos(a.session!.householdId)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[DOORBELL SOS]', e)
    return fail(`Failed to raise SOS alert: ${msg}`, 503)
  }

  return NextResponse.json({ ok: true, caseId: c.id })
}
