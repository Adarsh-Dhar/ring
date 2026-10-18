import { NextRequest, NextResponse } from 'next/server'
import { authorize, fail } from '@/lib/guard'
import { getDb } from '@/lib/db/client'
import { applyRiskEdit } from '@/lib/doorstep/caseRiskStore'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * P10: Helper observation confirmation/rejection route.
 * P5: Extended to support restore action with audit trail.
 * P9: Extended to support resolve action.
 * POST /api/doorbell/observation
 * Body: { caseId, idx, obsId?, action: 'confirm' | 'reject' | 'restore' | 'resolve', reason? }
 *       OR { caseId, action: 'reset', reason }
 *
 * - Confirm: changes uncertain observation to confirmed with source 'helper'
 * - Reject: records a correction, marks observation as retracted
 * - Restore: removes a rejection (requires reason)
 * - Resolve: marks observation as resolved (keeps points, removes floor/minScore; requires reason)
 * - Reset: soft-retracts ALL observations (requires reason; caller must be a household helper)
 * - obsId is preferred over idx; pass both for one-release backward compat
 * - Cross-household requests are rejected
 * - Returns new score and mode after re-scoring
 * - Emergency alert is sent by applyRiskEdit when case becomes emergency
 */
export async function POST(req: NextRequest) {
  const a = await authorize(req, 'helper')
  if (a.ok === false) return a.res

  try {
    const body = await req.json()
    const { caseId, idx, obsId, action, reason } = body

    if (!caseId || !action) {
      return fail('Missing required fields: caseId, action', 400)
    }

    if (action === 'reset') {
      if (!reason) return fail('Reset action requires a reason', 400)
    } else {
      if (action !== 'confirm' && action !== 'reject' && action !== 'restore' && action !== 'resolve') {
        return fail('Action must be "confirm", "reject", "restore", "resolve", or "reset"', 400)
      }
      if (idx === undefined && !obsId) {
        return fail('Missing required field: idx or obsId', 400)
      }
      // P5: Restore requires a reason
      // P9: Resolve requires a reason
      if ((action === 'restore' || action === 'resolve') && !reason) {
        return fail(`${action} action requires a reason`, 400)
      }
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
      select: { householdId: true },
    })

    if (!c) {
      return fail('Case not found', 404)
    }

    if (c.householdId !== membership.householdId) {
      return fail('Cross-household access not allowed', 403)
    }

    let result: { ok: true } | { ok: false; error: string }

    if (action === 'reset') {
      result = await applyRiskEdit(caseId, { kind: 'reset', who: a.session!.membershipId, reason })
    } else {
      result = await applyRiskEdit(caseId, {
        kind: 'helper',
        idx: typeof idx === 'number' ? idx : 0,
        obsId: typeof obsId === 'string' ? obsId : undefined,
        action,
        who: a.session!.membershipId,
        reason,
      })
    }

    if (!result.ok) {
      return fail((result as { ok: false; error: string }).error, 409)
    }

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
