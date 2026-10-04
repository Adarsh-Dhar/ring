import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { confirmCase } from '@/lib/doorbell/store'
import { authorize, fail, parse } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'resident')
  if (a.ok === false) return a.res

  const p = await parse(req, z.object({
    caseId: z.string().min(1).max(80),
    ok:     z.boolean(),
  }))
  if (p.ok === false) return p.res

  let c: Awaited<ReturnType<typeof confirmCase>>
  try {
    c = await confirmCase(a.session!.householdId, p.data.caseId, p.data.ok)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[DOORBELL CONFIRM]', e)
    return fail(`Failed to confirm visitor: ${msg}`, 503)
  }

  if (!c) return fail('No active case to confirm. The case may have already been resolved.', 404)
  return NextResponse.json({ ok: true })
}
