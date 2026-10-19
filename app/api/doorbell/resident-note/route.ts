import { NextRequest, NextResponse } from 'next/server'
import { authorize, fail } from '@/lib/guard'
import { getDb } from '@/lib/db/client'
import { applyRiskEdit } from '@/lib/doorstep/caseRiskStore'
import { splitCase } from '@/lib/doorstep/caseSplit'
import { openSplitCase } from '@/lib/doorbell/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Section 8.2: what a resident may do with a case. None of these changes the score or retracts anything.
 * POST /api/doorbell/resident-note
 * Body: { caseId, action: 'dispute', obsId, note? }                   flag an observation for the helper to review
 *     | { caseId, action: 'statement', kind: 'expected' | 'known', note? }   "this visitor is expected or known"
 *     | { caseId, action: 'split' }                                   split a "possible new visitor" into a new case
 * Only an authenticated helper can retract an observation. The resident can only flag it.
 */
export async function POST(req: NextRequest) {
  const a = await authorize(req, 'resident')
  if (a.ok === false) return a.res
  let body: any
  try { body = await req.json() } catch { return fail('Request body must be valid JSON', 400) }
  const { caseId, action } = body ?? {}
  if (typeof caseId !== 'string' || !caseId) return fail('Missing required field: caseId', 400)

  const c = await getDb().case.findUnique({ where: { id: caseId }, select: { householdId: true } })
  if (!c) return fail('Case not found', 404)
  if (c.householdId !== a.session!.householdId) return fail('Cross-household access not allowed', 403)
  const who = a.session!.userId

  try {
    if (action === 'dispute') {
      if (typeof body.obsId !== 'string' || !body.obsId) return fail('Missing required field: obsId', 400)
      const r = await applyRiskEdit(caseId, { kind: 'dispute', obsId: body.obsId, who, note: typeof body.note === 'string' ? body.note.slice(0, 500) : undefined })
      return r.ok === false ? fail(r.error, 409) : NextResponse.json({ ok: true })
    }
    if (action === 'statement') {
      if (body.kind !== 'expected' && body.kind !== 'known') return fail('kind must be "expected" or "known"', 400)
      const r = await applyRiskEdit(caseId, { kind: 'statement', statementKind: body.kind, who, note: typeof body.note === 'string' ? body.note.slice(0, 500) : undefined })
      return r.ok === false ? fail(r.error, 409) : NextResponse.json({ ok: true })
    }
    if (action === 'split') {
      const r = await splitCase(caseId, { role: 'resident', id: who }, (hid, from) => openSplitCase(hid, from))
      return r.ok === false ? fail(r.error, r.status) : NextResponse.json({ ok: true, newCaseId: r.newCaseId })
    }
    return fail('Action must be "dispute", "statement" or "split"', 400)
  } catch (e) {
    console.error('[RESIDENT NOTE]', e)
    return fail(`Failed to process request: ${e instanceof Error ? e.message : String(e)}`, 503)
  }
}
