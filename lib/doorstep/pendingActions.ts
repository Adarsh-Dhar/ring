/**
 * Pending actions for single-use helper approvals (Section 7).
 *
 * When gateOrAsk returns ask_helper, instead of silently skipping the action, we create a pending action.
 * Helpers can approve or reject specific actions. Approval is single-use: executes once, then is consumed.
 * Stored in Case.pendingActions as a JSON array.
 */
import { getDb } from '@/lib/db/client'

export type PendingActionState = 'pending' | 'approved' | 'rejected' | 'consumed'

export interface PendingAction {
  id: string
  tool: string
  text: string
  reason?: string
  state: PendingActionState
  decidedBy?: string // userId
  decidedAt?: string // ISO timestamp
  createdAt: string // ISO timestamp
}

/**
 * Create a pending action for a case.
 */
export async function createPendingAction(
  caseId: string,
  tool: string,
  text: string,
  reason?: string
): Promise<PendingAction> {
  const db = getDb()
  const action: PendingAction = {
    id: `action_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tool,
    text,
    reason,
    state: 'pending',
    createdAt: new Date().toISOString(),
  }

  const c = await db.case.findUnique({ where: { id: caseId }, select: { pendingActions: true } })
  if (!c) throw new Error('Case not found')

  const actions = (c.pendingActions as any) || []
  actions.push(action)

  await db.case.update({
    where: { id: caseId },
    data: { pendingActions: actions },
  })

  return action
}

/**
 * Approve a pending action. Compare-and-set: only succeeds if state is 'pending'.
 */
export async function approvePendingAction(
  caseId: string,
  actionId: string,
  userId: string
): Promise<boolean> {
  const db = getDb()
  const c = await db.case.findUnique({ where: { id: caseId }, select: { pendingActions: true } })
  if (!c) return false

  const actions = (c.pendingActions as any) || []
  const action = actions.find((a: PendingAction) => a.id === actionId)
  if (!action || action.state !== 'pending') return false

  action.state = 'approved'
  action.decidedBy = userId
  action.decidedAt = new Date().toISOString()

  await db.case.update({
    where: { id: caseId },
    data: { pendingActions: actions },
  })

  return true
}

/**
 * Reject a pending action. Compare-and-set: only succeeds if state is 'pending'.
 */
export async function rejectPendingAction(
  caseId: string,
  actionId: string,
  userId: string,
  reason?: string
): Promise<boolean> {
  const db = getDb()
  const c = await db.case.findUnique({ where: { id: caseId }, select: { pendingActions: true } })
  if (!c) return false

  const actions = (c.pendingActions as any) || []
  const action = actions.find((a: PendingAction) => a.id === actionId)
  if (!action || action.state !== 'pending') return false

  action.state = 'rejected'
  action.decidedBy = userId
  action.decidedAt = new Date().toISOString()
  if (reason) action.reason = reason

  await db.case.update({
    where: { id: caseId },
    data: { pendingActions: actions },
  })

  return true
}

/**
 * Mark a pending action as consumed (after execution). Only succeeds if state is 'approved'.
 */
export async function consumePendingAction(caseId: string, actionId: string): Promise<boolean> {
  const db = getDb()
  const c = await db.case.findUnique({ where: { id: caseId }, select: { pendingActions: true } })
  if (!c) return false

  const actions = (c.pendingActions as any) || []
  const action = actions.find((a: PendingAction) => a.id === actionId)
  if (!action || action.state !== 'approved') return false

  action.state = 'consumed'

  await db.case.update({
    where: { id: caseId },
    data: { pendingActions: actions },
  })

  return true
}

/**
 * Get all pending actions for a case.
 */
export async function getPendingActions(caseId: string): Promise<PendingAction[]> {
  const db = getDb()
  const c = await db.case.findUnique({ where: { id: caseId }, select: { pendingActions: true } })
  if (!c) return []
  return (c.pendingActions as any) || []
}
