/**
 * POST /api/doorbell/action
 *
 * Approve or reject a pending action (Section 7).
 * Single-use approval: executes once, then is consumed.
 * Section 7.3: checks helperMayApprove preference.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/client'
import { approvePendingAction, rejectPendingAction, consumePendingAction, getPendingActions } from '@/lib/doorstep/pendingActions'
import { writeAudit, audit } from '@/lib/doorstep/audit'
import { gateAction } from '@/lib/doorstep/actionGate'
import { getPreferences } from '@/lib/db/preferences'
import type { Decision } from '@/lib/doorstep/residentPreferences'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { caseId, actionId, decision, reason, decisionType } = body

    if (!caseId || !actionId || !decision) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (decision !== 'approve' && decision !== 'reject') {
      return NextResponse.json({ error: 'Invalid decision' }, { status: 400 })
    }

    const db = getDb()
    const c = await db.case.findUnique({
      where: { id: caseId },
      select: { householdId: true, status: true, riskScore: true, controlMode: true },
    })

    if (!c) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 })
    }

    if (c.status !== 'waiting') {
      return NextResponse.json({ error: 'Case is not waiting' }, { status: 400 })
    }

    const userId = req.headers.get('x-user-id')
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Section 7.3: Check helperMayApprove preference
    const prefs = await getPreferences(c.householdId)
    if (decision === 'approve' && decisionType) {
      const mayApprove = prefs.helperMayApprove?.[decisionType as Decision]
      if (!mayApprove) {
        return NextResponse.json({ error: 'Helper may not approve this action type' }, { status: 403 })
      }
    }

    let success = false
    if (decision === 'approve') {
      success = await approvePendingAction(caseId, actionId, userId)
      if (success) {
        await writeAudit(caseId, audit.actionApproved(userId, actionId, body.tool))

        // Execute the action if within authority
        const gate = gateAction(body.tool, c.riskScore ?? 0, prefs)
        if (gate.decision === 'allow') {
          await consumePendingAction(caseId, actionId)
          // Here you would execute the actual action
          // For now, just mark as consumed
        }
      }
    } else {
      success = await rejectPendingAction(caseId, actionId, userId, reason)
      if (success) {
        await writeAudit(caseId, audit.actionRejected(userId, actionId, body.tool, reason))
      }
    }

    if (!success) {
      return NextResponse.json({ error: 'Action not found or already decided' }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('[ACTION API]', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
