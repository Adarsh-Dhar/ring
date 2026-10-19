/**
 * POST /api/doorbell/action
 *
 * Approve or reject a pending action (Section 7).
 * Single-use approval: executes once, then is consumed.
 * Section 7.3: checks helperMayApprove preference.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { approvePendingAction, rejectPendingAction, consumePendingAction, getPendingActions } from '@/lib/doorstep/pendingActions'
import { writeAudit, audit } from '@/lib/doorstep/audit'
import { gateAction } from '@/lib/doorstep/actionGate'
import { getPreferences } from '@/lib/db/preferences'
import type { Decision } from '@/lib/doorstep/residentPreferences'
import { authorize, fail, parse } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const Body = z.object({
  caseId: z.string().min(1).max(80),
  actionId: z.string().min(1).max(80),
  decision: z.enum(['approve', 'reject']),
  reason: z.string().optional(),
  decisionType: z.enum(['greet_visitor', 'ask_purpose', 'ask_for_id', 'tell_visitor_to_leave', 'accept_parcel', 'approve_short_notice']).optional(),
})

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'helper')
  if (a.ok === false) return a.res

  const p = await parse(req, Body)
  if (p.ok === false) return p.res

  const { caseId, actionId, decision, reason, decisionType } = p.data

  const householdId = a.session!.householdId
  const membershipId = a.session!.membershipId!

  const db = getDb()
  const c = await db.case.findUnique({
    where: { id: caseId, householdId },
    select: { householdId: true, status: true, riskScore: true, controlMode: true },
  })

  if (!c) {
    return fail('Case not found', 404)
  }

  if (c.status !== 'waiting') {
    return fail('Case is not waiting', 400)
  }

  // Section 7.3: Check helperMayApprove preference
  const prefs = await getPreferences(householdId)
  if (decision === 'approve' && decisionType) {
    const mayApprove = prefs.helperMayApprove?.[decisionType as Decision]
    if (!mayApprove) {
      return fail('Helper may not approve this action type', 403)
    }
  }

  let success = false
  if (decision === 'approve') {
    success = await approvePendingAction(caseId, actionId, membershipId)
    if (success) {
      await writeAudit(caseId, audit.actionApproved(membershipId, actionId, decisionType || 'unknown'))

      // Execute the action if within authority
      const gate = gateAction(decisionType || 'unknown', c.riskScore ?? 0, prefs)
      if (gate.decision === 'allow') {
        await consumePendingAction(caseId, actionId)
        // Here you would execute the actual action
        // For now, just mark as consumed
      }
    }
  } else {
    success = await rejectPendingAction(caseId, actionId, membershipId, reason)
    if (success) {
      await writeAudit(caseId, audit.actionRejected(membershipId, actionId, decisionType || 'unknown', reason))
    }
  }

  if (!success) {
    return fail('Action not found or already decided', 400)
  }

  return NextResponse.json({ success: true })
}
