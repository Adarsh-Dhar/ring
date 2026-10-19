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
  /** Who must approve: a helper (default) or the resident (short-notice resident_approval). */
  approver?: 'helper' | 'resident'
  /** 'ai_action' = an AI tool awaiting a helper; 'visit_approval' = a short-notice visit awaiting approval. */
  kind?: 'ai_action' | 'visit_approval'
  decidedBy?: string // userId
  decidedAt?: string // ISO timestamp
  createdAt: string // ISO timestamp
}

/**
 * Read-modify-write the Case.pendingActions array under a row lock, so two requests acting on the same case
 * (two helpers approving, or an approval racing the AI consuming it) cannot overwrite each other.
 * `fn` gets the current array and returns the result; it may mutate the array in place.
 * Returns null when the case does not exist.
 */
async function withActions<T>(caseId: string, fn: (actions: PendingAction[]) => T): Promise<T | null> {
  const db = getDb()
  return db.$transaction(async (tx: any) => {
    const rows = await tx.$queryRaw`SELECT "pendingActions" FROM "Case" WHERE "id" = ${caseId} FOR UPDATE`
    if (!Array.isArray(rows) || rows.length === 0) return null
    const raw = rows[0].pendingActions
    const actions: PendingAction[] = Array.isArray(raw) ? raw : []
    const result = fn(actions)
    await tx.case.update({ where: { id: caseId }, data: { pendingActions: actions as any } })
    return result
  })
}

/**
 * Create a pending action for a case.
 * Deduplicates: only creates if no pending or approved action for this tool already exists
 * (an approved one is still waiting to be used, so asking again would be noise).
 */
export async function createPendingAction(
  caseId: string,
  tool: string,
  text: string,
  reason?: string,
  opts: { approver?: 'helper' | 'resident'; kind?: 'ai_action' | 'visit_approval' } = {}
): Promise<PendingAction | null> {
  const created = await withActions(caseId, (actions) => {
    if (actions.some((a) => a.tool === tool && (a.state === 'pending' || a.state === 'approved'))) return null
    const action: PendingAction = {
      id: `action_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tool,
      text,
      reason,
      approver: opts.approver ?? 'helper',
      kind: opts.kind ?? 'ai_action',
      state: 'pending',
      createdAt: new Date().toISOString(),
    }
    actions.push(action)
    return action
  })
  if (created === null && !(await getDb().case.findUnique({ where: { id: caseId }, select: { id: true } }))) {
    throw new Error('Case not found')
  }
  return created
}

/** Approve a pending action. Compare-and-set: only succeeds if state is 'pending'. */
export async function approvePendingAction(caseId: string, actionId: string, userId: string): Promise<boolean> {
  const ok = await withActions(caseId, (actions) => {
    const action = actions.find((a) => a.id === actionId)
    if (!action || action.state !== 'pending') return false
    action.state = 'approved'
    action.decidedBy = userId
    action.decidedAt = new Date().toISOString()
    return true
  })
  return ok === true
}

/** Reject a pending action. Compare-and-set: only succeeds if state is 'pending'. */
export async function rejectPendingAction(caseId: string, actionId: string, userId: string, reason?: string): Promise<boolean> {
  const ok = await withActions(caseId, (actions) => {
    const action = actions.find((a) => a.id === actionId)
    if (!action || action.state !== 'pending') return false
    action.state = 'rejected'
    action.decidedBy = userId
    action.decidedAt = new Date().toISOString()
    if (reason) action.reason = reason
    return true
  })
  return ok === true
}

/** Mark a pending action as consumed (after execution). Only succeeds if state is 'approved'. */
export async function consumePendingAction(caseId: string, actionId: string): Promise<boolean> {
  const ok = await withActions(caseId, (actions) => {
    const action = actions.find((a) => a.id === actionId)
    if (!action || action.state !== 'approved') return false
    action.state = 'consumed'
    return true
  })
  return ok === true
}

/**
 * Single-use approval (spec 7.3): if a helper has approved this tool, spend that approval now and return it.
 * The AI calls this at the moment it wants to act, so an approval covers exactly one use.
 * Returns null when there is no approved action for the tool.
 */
export async function consumeApprovedForTool(caseId: string, tool: string): Promise<PendingAction | null> {
  const found = await withActions(caseId, (actions) => {
    const action = actions.find((a) => a.tool === tool && a.state === 'approved')
    if (!action) return null
    action.state = 'consumed'
    return { ...action }
  })
  return found ?? null
}

/** Get all pending actions for a case. */
export async function getPendingActions(caseId: string): Promise<PendingAction[]> {
  const db = getDb()
  const c = await db.case.findUnique({ where: { id: caseId }, select: { pendingActions: true } })
  if (!c) return []
  return (c.pendingActions as any) || []
}

/** Give a reserved approval back after the action failed to run, so a failed playback does not burn the approval. */
export async function restoreApproval(caseId: string, actionId: string): Promise<boolean> {
  const ok = await withActions(caseId, (actions) => {
    const action = actions.find((a) => a.id === actionId)
    if (!action || action.state !== 'consumed') return false
    action.state = 'approved'
    return true
  })
  return ok === true
}
