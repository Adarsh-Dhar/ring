/**
 * request-lifecycle.ts
 *
 * Lightweight helpers that manage the lifecycle of VisitRequests without
 * importing store.ts, so the store can import this file without a cycle.
 */
import { getHousehold } from '../db/households'
import { findExpirable, transition, getRequest } from '../db/visit-requests'
import { notifyVisitor, msgs, firstName } from '../visitor-notify'

/**
 * Expire every pending request whose `expiresAt` has passed.
 * Each affected visitor is notified exactly once (the transition is atomic).
 */
export async function sweepRequests(householdId: string, now = Date.now()) {
  const rows = await findExpirable(householdId, new Date(now))
  if (!rows.length) return

  const hh = await getHousehold(householdId)
  for (const r of rows) {
    if (await transition(r.id, ['pending'], { status: 'expired', decidedAt: new Date(now) })) {
      notifyVisitor(r, msgs.expired(firstName(hh?.residentName))).catch(() => {})
    }
  }
}

/**
 * Called when a guardian removes the planned visit that a request created.
 * Cancels the request and tells the visitor once.
 */
export async function cancelRequestForVisit(householdId: string, requestId: string) {
  const r = await getRequest(householdId, requestId)
  if (!r) return
  if (await transition(r.id, ['approved'], { status: 'cancelled', decidedAt: new Date() })) {
    const hh = await getHousehold(householdId)
    notifyVisitor(r, msgs.cancelled(firstName(hh?.residentName))).catch(() => {})
  }
}
