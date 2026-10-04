import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail, parse } from '@/lib/guard'
import { decideRegistration, listForApprover, removeRegular } from '@/lib/doorbell/regular'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** GET: pending registrations (helper or resident) and approved regulars (helper only). Metadata only, no photos. */
export async function GET(req: NextRequest) {
  const a = await authorize(req, 'helper', 'resident')
  if (a.ok === false) return a.res
  try {
    const out = await listForApprover(a.session.householdId, a.session.kind === 'resident' ? 'resident' : 'helper')
    return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[REGULAR GET]', e)
    return fail('Failed to load regular visitors.', 503)
  }
}

/** POST: a helper OR the resident approves/declines. A guardian can also remove an approved regular. */
export async function POST(req: NextRequest) {
  const a = await authorize(req, 'helper', 'resident')
  if (a.ok === false) return a.res
  const p = await parse(req, z.object({
    id:       z.string().min(1).max(80),
    decision: z.enum(['approve', 'decline', 'remove']),
  }))
  if (p.ok === false) return p.res
  const s = a.session

  try {
    if (p.data.decision === 'remove') {
      if (s.role !== 'guardian') return fail('Only a guardian can remove a regular visitor.', 403)
      const r = await removeRegular(s.householdId, p.data.id)
      return r.ok === false ? fail(r.error, r.status) : NextResponse.json(r)
    }
    const r = await decideRegistration(
      s.householdId, p.data.id,
      { kind: s.kind === 'resident' ? 'resident' : 'helper', membershipId: s.membershipId },
      p.data.decision,
    )
    return r.ok === false ? fail(r.error, r.status) : NextResponse.json(r)
  } catch (e) {
    console.error('[REGULAR POST]', e)
    return fail('Could not save your answer. Try again.', 503)
  }
}
