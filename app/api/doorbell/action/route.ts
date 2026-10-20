/**
 * POST /api/doorbell/action
 *
 * Approve or reject a pending action (Section 7).
 * Single-use approval: approving records a one-time permission; the AI spends it the next time it needs that
 * tool (see gateOrAsk), and it is then consumed. Nothing runs from this route.
 * Section 7.3: a helper may only approve what the resident has allowed (helperMayApprove). The decision type is
 * derived from the pending action's tool on the server, never from the request body.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { approvePendingAction, rejectPendingAction, getPendingActions } from '@/lib/doorstep/pendingActions'
import { writeAudit, audit } from '@/lib/doorstep/audit'
import { decisionForTool } from '@/lib/doorstep/actionGate'
import { PROHIBITED_TOOLS } from '@/lib/doorstep/authorityCosts'
import { getPreferences } from '@/lib/db/preferences'
import { authorize, fail, parse } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const Body = z.object({
  caseId: z.string().min(1).max(80),
  actionId: z.string().min(1).max(80),
  decision: z.enum(['approve', 'reject']),
  reason: z.string().max(500).optional(),
})

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'helper')
  if (a.ok === false) return a.res

  const p = await parse(req, Body)
  if (p.ok === false) return p.res

  const { caseId, actionId, decision, reason } = p.data

  const householdId = a.session!.householdId
  const membershipId = a.session!.membershipId
  if (!householdId || !membershipId) return fail('Not a helper of this household', 403)

  const db = getDb()
  const c = await db.case.findFirst({
    where: { id: caseId, householdId },
    select: { status: true, chain: true, closedAt: true },
  })
  if (!c) return fail('Case not found', 404)

  if (c.closedAt) return fail('Case is closed', 400)

  // A short-notice case that nobody answered is 'no_response' but still needs a decision, so both are open.
  if (c.status !== 'waiting' && c.status !== 'no_response') return fail('Case is closed', 400)

  const chain = ((c.chain as unknown) as string[] | null) ?? []
  if (chain.length > 0 && !chain.includes(membershipId)) return fail('You are not a helper on this case', 403)

  // The tool comes from the stored action, so the caller cannot pick a weaker decision type to get past the check.
  const pending = (await getPendingActions(caseId)).find((x) => x.id === actionId)
  if (!pending) return fail('Action not found', 404)

  // H-28: Check if this approval belongs to the resident
  if ((pending.approver ?? 'helper') !== 'helper') {
    return fail('This approval belongs to the resident', 403)
  }

  const decisionType = decisionForTool(pending.tool)

  if (decision === 'approve') {
    if ((PROHIBITED_TOOLS as readonly string[]).includes(pending.tool)) {
      return fail('This action can never be approved', 403)
    }
    if (decisionType) {
      const prefs = await getPreferences(householdId)
      if (!prefs.helperMayApprove?.[decisionType]) {
        return fail('The resident has not allowed helpers to approve this action', 403)
      }
    }
    const ok = await approvePendingAction(caseId, actionId, membershipId)
    if (!ok) return fail('Action not found or already decided', 409)
    await writeAudit(caseId, audit.actionApproved(membershipId, actionId, decisionType ?? pending.tool))
    return NextResponse.json({ success: true, state: 'approved' })
  }

  const ok = await rejectPendingAction(caseId, actionId, membershipId, reason)
  if (!ok) return fail('Action not found or already decided', 409)
  await writeAudit(caseId, audit.actionRejected(membershipId, actionId, decisionType ?? pending.tool, reason))
  return NextResponse.json({ success: true, state: 'rejected' })
}
