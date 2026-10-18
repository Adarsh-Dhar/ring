import { NextRequest, NextResponse } from 'next/server'
import { authorize, fail } from '@/lib/guard'
import { getDb } from '@/lib/db/client'
import { parseNoticeSettings, validateNoticeSettingsInput } from '@/lib/doorstep/noticePolicy'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const select = { minNoticeHours: true, shortNoticePolicy: true, unknownVisitorPolicy: true, approvalTimerSec: true } as const

/** GET /api/household/notice: the minimum-notice settings (spec section 3). */
export async function GET(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res
  try {
    const h = await getDb().household.findUnique({ where: { id: a.session!.householdId }, select })
    if (!h) return fail('Household not found', 404)
    return NextResponse.json(parseNoticeSettings(h), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[NOTICE GET]', e)
    return fail('Could not load notice settings', 503)
  }
}

/** PUT /api/household/notice: validated write of the four notice settings. Notice never adds risk points. */
export async function PUT(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res
  let body: unknown
  try { body = await req.json() } catch { return fail('Request body must be valid JSON', 400) }
  const v = validateNoticeSettingsInput((body as any)?.settings)
  if (v.ok === false) return fail(v.error, 400)
  try {
    const h = await getDb().household.update({ where: { id: a.session!.householdId }, data: v.value, select })
    return NextResponse.json(parseNoticeSettings(h), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[NOTICE PUT]', e)
    return fail('Could not save notice settings', 503)
  }
}
