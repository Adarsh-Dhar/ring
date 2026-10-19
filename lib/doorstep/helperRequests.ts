/**
 * Helper request state machine (Section 7.2).
 *
 * Tracks the lifecycle of a request sent to a helper: sent -> delivered -> acked -> accepted/declined/timed_out.
 * Uses compare-and-set transitions to ensure exactly-once semantics, similar to the escalation claim system.
 *
 * Section 8: each state transition refreshes the case lifecycle, so the UI stays in sync with request status.
 */
import { getDb } from '@/lib/db/client'
import { refreshLifecycle } from './caseLifecycle'

export type HelperRequestKind = 'approval' | 'risk_decision' | 'takeover' | 'emergency'
export type HelperRequestState = 'sent' | 'delivered' | 'acked' | 'accepted' | 'declined' | 'timed_out'

export interface HelperRequest {
  id: string
  caseId: string
  membershipId: string
  kind: HelperRequestKind
  round: number
  state: HelperRequestState
  sentAt: Date
  deliveredAt?: Date | null
  ackedAt?: Date | null
  acceptedAt?: Date | null
  declinedAt?: Date | null
  timedOutAt?: Date | null
  channels: Record<string, any>
  snapshot?: any
}

export interface CreateHelperRequest {
  caseId: string
  membershipId: string
  kind: HelperRequestKind
  round?: number
  channels?: Record<string, any>
  snapshot?: any
}

/** States in which a request is still live (the helper has not yet answered or run out of time). */
export const OPEN_REQUEST_STATES: HelperRequestState[] = ['sent', 'delivered', 'acked']

/**
 * Create a new helper request in the 'sent' state.
 *
 * Deduplicates: returns null when this helper already has a live (sent/delivered/acked) request of the
 * same kind for the same case. A finished request (accepted, declined, timed_out) does not block a new one,
 * so retries after a timeout still work. A partial unique index in the database enforces the same rule
 * under concurrency; the P2002 it raises is treated as "already exists".
 */
export async function createHelperRequest(input: CreateHelperRequest): Promise<HelperRequest | null> {
  const db = getDb()
  const open = await db.helperRequest.findFirst({
    where: { caseId: input.caseId, membershipId: input.membershipId, kind: input.kind, state: { in: OPEN_REQUEST_STATES } },
    select: { id: true },
  })
  if (open) return null
  try {
    const request = await db.helperRequest.create({
      data: {
        caseId: input.caseId,
        membershipId: input.membershipId,
        kind: input.kind,
        round: input.round ?? 1,
        state: 'sent',
        channels: input.channels ?? {},
        snapshot: input.snapshot,
      },
    })
    return request as HelperRequest
  } catch (e: any) {
    if (e?.code === 'P2002') return null
    throw e
  }
}

/**
 * Mark a request as delivered. Compare-and-set: only succeeds if current state is 'sent'.
 */
export async function markDelivered(requestId: string): Promise<boolean> {
  const db = getDb()
  const result = await db.helperRequest.updateMany({
    where: { id: requestId, state: 'sent' },
    data: { deliveredAt: new Date(), state: 'delivered' },
  })
  if (result.count === 1) {
    const request = await db.helperRequest.findUnique({ where: { id: requestId }, select: { caseId: true } })
    if (request) await refreshLifecycle(request.caseId)
  }
  return result.count === 1
}

/**
 * Mark a request as acknowledged. Compare-and-set: only succeeds if current state is 'delivered' or 'sent'.
 */
export async function markAcked(requestId: string): Promise<boolean> {
  const db = getDb()
  const result = await db.helperRequest.updateMany({
    where: { id: requestId, state: { in: ['sent', 'delivered'] } },
    data: { ackedAt: new Date(), state: 'acked' },
  })
  if (result.count === 1) {
    const request = await db.helperRequest.findUnique({ where: { id: requestId }, select: { caseId: true } })
    if (request) await refreshLifecycle(request.caseId)
  }
  return result.count === 1
}

/**
 * Mark a request as accepted. Compare-and-set: only succeeds if current state is 'acked'.
 */
export async function markAccepted(requestId: string): Promise<boolean> {
  const db = getDb()
  const result = await db.helperRequest.updateMany({
    where: { id: requestId, state: 'acked' },
    data: { acceptedAt: new Date(), state: 'accepted' },
  })
  if (result.count === 1) {
    const request = await db.helperRequest.findUnique({ where: { id: requestId }, select: { caseId: true } })
    if (request) await refreshLifecycle(request.caseId)
  }
  return result.count === 1
}

/**
 * Mark a request as declined. Compare-and-set: only succeeds if current state is 'acked'.
 */
export async function markDeclined(requestId: string): Promise<boolean> {
  const db = getDb()
  const result = await db.helperRequest.updateMany({
    where: { id: requestId, state: 'acked' },
    data: { declinedAt: new Date(), state: 'declined' },
  })
  if (result.count === 1) {
    const request = await db.helperRequest.findUnique({ where: { id: requestId }, select: { caseId: true } })
    if (request) await refreshLifecycle(request.caseId)
  }
  return result.count === 1
}

/**
 * Mark a request as timed out. Compare-and-set: only succeeds if current state is not already terminal.
 */
export async function markTimedOut(requestId: string): Promise<boolean> {
  const db = getDb()
  const result = await db.helperRequest.updateMany({
    where: { id: requestId, state: { in: ['sent', 'delivered', 'acked'] } },
    data: { timedOutAt: new Date(), state: 'timed_out' },
  })
  if (result.count === 1) {
    const request = await db.helperRequest.findUnique({ where: { id: requestId }, select: { caseId: true } })
    if (request) await refreshLifecycle(request.caseId)
  }
  return result.count === 1
}

/**
 * Get all requests for a case, ordered by creation time.
 */
export async function getRequestsForCase(caseId: string): Promise<HelperRequest[]> {
  const db = getDb()
  const requests = await db.helperRequest.findMany({
    where: { caseId },
    orderBy: { sentAt: 'asc' },
  })
  return requests as HelperRequest[]
}

/**
 * Get the most recent request for a membership and kind.
 */
export async function getLatestRequest(
  caseId: string,
  membershipId: string,
  kind: HelperRequestKind
): Promise<HelperRequest | null> {
  const db = getDb()
  const request = await db.helperRequest.findFirst({
    where: { caseId, membershipId, kind },
    orderBy: { sentAt: 'desc' },
  })
  return request as HelperRequest | null
}

/**
 * Update channels field with delivery results.
 */
export async function updateChannels(requestId: string, channels: Record<string, any>): Promise<void> {
  const db = getDb()
  await db.helperRequest.update({
    where: { id: requestId },
    data: { channels },
  })
}

/** Request kinds an ordinary acknowledgement/decision timer may expire. 'emergency' is excluded on purpose:
 *  an expired approval must never close a live emergency request. */
export const TIMER_EXPIRABLE_KINDS: HelperRequestKind[] = ['approval', 'risk_decision', 'takeover']

/**
 * The helper missed their answer window for this case: expire their open requests of the timer-expirable kinds.
 * Compare-and-set per request, so requests that are already finished are left alone. Returns how many expired.
 */
export async function expireHelperRequests(caseId: string, membershipId: string): Promise<number> {
  let n = 0
  for (const kind of TIMER_EXPIRABLE_KINDS) {
    const request = await getLatestRequest(caseId, membershipId, kind)
    if (request && (await markTimedOut(request.id))) n++
  }
  return n
}
