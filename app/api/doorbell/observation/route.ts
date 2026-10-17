import { NextRequest, NextResponse } from 'next/server'
import { authorize, fail } from '@/lib/guard'
import { getDb } from '@/lib/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * P10: Helper observation confirmation/rejection route.
 * POST /api/doorbell/observation
 * Body: { caseId, observationIndex, action: 'confirm' | 'reject' }
 * 
 * - Confirm: changes uncertain observation to confirmed with source 'helper'
 * - Reject: records a correction
 * - Cross-household requests are rejected
 */
export async function POST(req: NextRequest) {
  const a = await authorize(req, 'helper')
  if (a.ok === false) return a.res

  try {
    const body = await req.json()
    const { caseId, observationIndex, action } = body

    if (!caseId || observationIndex === undefined || !action) {
      return fail('Missing required fields: caseId, observationIndex, action', 400)
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

    const riskObs = c.riskObservations as any
    if (!riskObs || !riskObs.observations) {
      return fail('No observations found for this case', 400)
    }

    const observations = riskObs.observations
    if (observationIndex < 0 || observationIndex >= observations.length) {
      return fail('Invalid observation index', 400)
    }

    const observation = observations[observationIndex]

    if (action === 'confirm') {
      // Confirm: change state to confirmed and source to 'helper'
      observation.state = 'confirmed'
      observation.source = 'helper'
    } else if (action === 'reject') {
      // Reject: record a correction (this is a simplified implementation)
      // In a full implementation, this would create a separate correction record
      // For now, we mark it as unavailable and add a debug note
      observation.state = 'unavailable'
      observation.debug = { ...observation.debug, rejectedBy: 'helper', rejectedAt: new Date().toISOString() }
    }

    await db.case.update({
      where: { id: caseId },
      data: {
        riskObservations: {
          observations,
          interviewState: riskObs.interviewState ?? {},
        },
      },
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[OBSERVATION]', e)
    return fail(`Failed to process observation: ${msg}`, 503)
  }
}
