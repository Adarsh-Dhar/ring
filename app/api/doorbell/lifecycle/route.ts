import { NextRequest, NextResponse } from 'next/server'
import { authorize, fail } from '@/lib/guard'
import { getDb } from '@/lib/db/client'
import { markVisitorLeft, closeCaseByHelper, getPriorSeriousEvents } from '@/lib/doorstep/caseLifecycle'
import { splitCase } from '@/lib/doorstep/caseSplit'
import { openSplitCase } from '@/lib/doorbell/store'
import { CASE_OUTCOMES } from '@/lib/doorstep/riskRules'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Section 8 lifecycle actions for a helper.
 * POST /api/doorbell/lifecycle
 * Body: { caseId, action: 'visitor_left' }
 *     | { caseId, action: 'close', outcome: 'resolved_safe' | 'resolved_incident' | 'false_alarm', reason? }
 *     | { caseId, action: 'split' }          (a "possible new visitor" becomes a new case at score 0)
 * GET  /api/doorbell/lifecycle?caseId=...    earlier serious events inside the resident-set window (information only)
 */
async function ownCase(req: NextRequest, caseId: unknown) {
  const a = await authorize(req, 'helper')
  if (a.ok === false) return { res: a.res } as const
  if (typeof caseId !== 'string' || !caseId) return { res: fail('Missing required field: caseId', 400) } as const
  const membership = await getDb().membership.findUnique({ where: { id: a.session!.membershipId } })
  if (!membership) return { res: fail('Membership not found', 404) } as const
  const c = await getDb().case.findUnique({ where: { id: caseId }, select: { householdId: true } })
  if (!c) return { res: fail('Case not found', 404) } as const
  if (c.householdId !== membership.householdId) return { res: fail('Cross-household access not allowed', 403) } as const
  return { session: a.session!, householdId: c.householdId, caseId } as const
}

export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() } catch { return fail('Request body must be valid JSON', 400) }
  const o = await ownCase(req, body?.caseId)
  if ('res' in o) return o.res
  const who = o.session.membershipId!

  try {
    switch (body.action) {
      case 'visitor_left': {
        const r = await markVisitorLeft(o.caseId, { role: 'helper', id: who })
        return r.ok === false ? fail(r.error, r.status) : NextResponse.json({ ok: true, lifecycle: r.lifecycle })
      }
      case 'close': {
        if (!(CASE_OUTCOMES as readonly string[]).includes(body.outcome)) return fail(`outcome must be one of ${CASE_OUTCOMES.join(', ')}`, 400)
        const r = await closeCaseByHelper(o.caseId, who, body.outcome, typeof body.reason === 'string' ? body.reason : undefined)
        return r.ok === false ? fail(r.error, r.status) : NextResponse.json({ ok: true, outcome: r.outcome })
      }
      case 'split': {
        const r = await splitCase(o.caseId, { role: 'helper', id: who }, (hid, from) => openSplitCase(hid, from))
        return r.ok === false ? fail(r.error, r.status) : NextResponse.json({ ok: true, newCaseId: r.newCaseId, moved: r.moved })
      }
      default:
        return fail('Action must be "visitor_left", "close" or "split"', 400)
    }
  } catch (e) {
    console.error('[LIFECYCLE]', e)
    return fail(`Failed to process lifecycle action: ${e instanceof Error ? e.message : String(e)}`, 503)
  }
}

export async function GET(req: NextRequest) {
  const o = await ownCase(req, req.nextUrl.searchParams.get('caseId'))
  if ('res' in o) return o.res
  try {
    const prior = await getPriorSeriousEvents(o.householdId, o.caseId)
    return NextResponse.json({ prior }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[LIFECYCLE GET]', e)
    return fail('Could not load earlier events', 503)
  }
}
