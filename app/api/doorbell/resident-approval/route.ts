/**
 * POST /api/doorbell/resident-approval
 *
 * The resident approves or rejects a pending action whose approver is the resident (short-notice `resident_approval`).
 * Helpers cannot use this route and the resident cannot use /api/doorbell/action: each approval has one owner.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { approvePendingAction, rejectPendingAction, getPendingActions } from '@/lib/doorstep/pendingActions'
import { writeAudit, createAuditEvent } from '@/lib/doorstep/audit'
import { PROHIBITED_TOOLS } from '@/lib/doorstep/authorityCosts'
import { authorize, fail, parse } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const Body = z.object({
  caseId: z.string().min(1).max(80),
  actionId: z.string().min(1).max(80),
  decision: z.enum(['approve', 'reject']),
})

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'resident')
  if (a.ok === false) return a.res
  const p = await parse(req, Body)
  if (p.ok === false) return p.res
  const householdId = a.session!.householdId
  if (!householdId) return fail('No household', 400)
  const { caseId, actionId, decision } = p.data

  const c = await getDb().case.findFirst({ where: { id: caseId, householdId }, select: { status: true, closedAt: true } })
  if (!c) return fail('Case not found', 404)
  if (c.closedAt) return fail('Case is closed', 400)
  if (c.status !== 'waiting' && c.status !== 'no_response') return fail('Case is closed', 400)

  const pending = (await getPendingActions(caseId)).find((x) => x.id === actionId)
  if (!pending) return fail('Action not found', 404)
  if (pending.approver !== 'resident') return fail('This action is not for the resident to decide', 403)
  if (decision === 'approve' && (PROHIBITED_TOOLS as readonly string[]).includes(pending.tool)) return fail('This action can never be approved', 403)

  const who = a.session!.userId ?? 'resident'
  const ok = decision === 'approve' ? await approvePendingAction(caseId, actionId, who) : await rejectPendingAction(caseId, actionId, who)
  if (!ok) return fail('Already decided', 409)
  await writeAudit(caseId, createAuditEvent('resident', decision === 'approve' ? 'action_approved' : 'action_rejected', { tool: pending.tool }, actionId, who))
  return NextResponse.json({ success: true, state: decision === 'approve' ? 'approved' : 'rejected' })
}
