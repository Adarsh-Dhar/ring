import { NextRequest, NextResponse } from 'next/server'
import { authorize, fail } from '@/lib/guard'
import { getDb } from '@/lib/db/client'
import { applyRiskEdit } from '@/lib/doorstep/caseRiskStore'
import { scoreObservations } from '@/lib/doorstep/riskRules'
import { readStored } from '@/lib/doorstep/caseRisk'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * P10: Helper observation confirmation/rejection route.
 * POST /api/doorbell/observation
 * Body: { caseId, idx, action: 'confirm' | 'reject' }
 * 
 * - Confirm: changes uncertain observation to confirmed with source 'helper'
 * - Reject: records a correction
 * - Cross-household requests are rejected
 * - Returns new score and mode after re-scoring
 * - Triggers emergency alert if case becomes emergency
 */
export async function POST(req: NextRequest) {
  const a = await authorize(req, 'helper')
  if (a.ok === false) return a.res

  try {
    const body = await req.json()
    const { caseId, idx, action } = body

    if (!caseId || idx === undefined || !action) {
      return fail('Missing required fields: caseId, idx, action', 400)
    }

    if (action !== 'confirm' && action !== 'reject') {
      return fail('Action must be "confirm" or "reject"', 400)
    }

    const db = getDb()
    const membership = await db.membership.findUnique({
      where: { id: a.session!.membershipId },
      include: { household: true },
    })

    if (!membership) {
      return fail('Membership not found', 404)
    }

    // Verify the case belongs to the helper's household
    const c = await db.case.findUnique({
      where: { id: caseId },
      select: { householdId: true, riskObservations: true },
    })

    if (!c) {
      return fail('Case not found', 404)
    }

    if (c.householdId !== membership.householdId) {
      // Cross-household access is rejected
      return fail('Cross-household access not allowed', 403)
    }

    // Use the single risk writer to apply the helper action
    await applyRiskEdit(caseId, { kind: 'helper', idx, action })

    // Reload the case to get the new score and mode
    const updated = await db.case.findUnique({
      where: { id: caseId },
      select: { riskScore: true, controlMode: true },
    })

    if (!updated) {
      return fail('Case not found after update', 404)
    }

    return NextResponse.json({ ok: true, riskScore: updated.riskScore, controlMode: updated.controlMode })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[OBSERVATION]', e)
    return fail(`Failed to process observation: ${msg}`, 503)
  }
}
