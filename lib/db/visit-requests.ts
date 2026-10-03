import { getDb } from './client'

const db = () => getDb()

// ── links ──────────────────────────────────────────────────────────────────────

export const createLink = (householdId: string, createdByUserId: string, tokenHash: string) =>
  db().visitRequestLink.create({ data: { householdId, createdByUserId, tokenHash } })

export const findActiveLinkByHash = (tokenHash: string) =>
  db().visitRequestLink.findFirst({
    where: { tokenHash, revokedAt: null },
    include: { household: true },
  })

export const findActiveLink = (householdId: string) =>
  db().visitRequestLink.findFirst({
    where: { householdId, revokedAt: null },
    orderBy: { createdAt: 'desc' },
  })

/**
 * Revokes every active link for the household, cancels their pending requests,
 * and returns the cancelled rows so the caller can notify the visitors.
 */
export async function revokeActiveLinks(householdId: string) {
  const links = await db().visitRequestLink.findMany({
    where: { householdId, revokedAt: null },
    select: { id: true },
  })
  const ids = links.map(l => l.id)
  if (!ids.length) return []

  const pending = await db().visitRequest.findMany({
    where: { linkId: { in: ids }, status: 'pending' },
  })

  await db().visitRequestLink.updateMany({
    where: { id: { in: ids } },
    data: { revokedAt: new Date() },
  })

  if (pending.length) {
    await db().visitRequest.updateMany({
      where: { id: { in: pending.map(p => p.id) }, status: 'pending' },
      data: { status: 'cancelled', decidedAt: new Date() },
    })
  }

  return pending
}

// ── counts for rate-limiting ───────────────────────────────────────────────────

export const countByIp = (ip: string, since: Date) =>
  db().visitRequest.count({ where: { ip, createdAt: { gte: since } } })

export const countByContact = (householdId: string, contact: string, since: Date) =>
  db().visitRequest.count({ where: { householdId, contact, createdAt: { gte: since } } })

export const countByLink = (linkId: string, since: Date) =>
  db().visitRequest.count({ where: { linkId, createdAt: { gte: since } } })

export const countOpen = (householdId: string) =>
  db().visitRequest.count({ where: { householdId, status: 'pending', expiresAt: { gt: new Date() } } })

// ── requests ───────────────────────────────────────────────────────────────────

export const createRequest = (data: any) =>
  db().visitRequest.create({ data })

export const getRequest = (householdId: string, id: string) =>
  db().visitRequest.findFirst({ where: { id, householdId } })

export const getRequestByToken = (statusToken: string) =>
  db().visitRequest.findUnique({ where: { statusToken } })

export const updateRequest = (id: string, data: any) =>
  db().visitRequest.update({ where: { id }, data })

export const listRequests = (householdId: string, statuses: string[], limit = 50) =>
  db().visitRequest.findMany({
    where: { householdId, status: { in: statuses } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

/**
 * Atomic state machine transition.
 * Returns false when the row was not in one of the `from` states (optimistic concurrency).
 */
export async function transition(id: string, from: string[], data: any): Promise<boolean> {
  const r = await db().visitRequest.updateMany({
    where: { id, status: { in: from } },
    data,
  })
  return r.count === 1
}

export const findExpirable = (householdId: string, now: Date) =>
  db().visitRequest.findMany({
    where: { householdId, status: 'pending', expiresAt: { lte: now } },
  })

/**
 * Binds the device cookie hash only if no device is bound yet (and the request is approved).
 * Returns false when already bound by a different device.
 */
export async function bindIfEmpty(id: string, deviceHash: string): Promise<boolean> {
  const r = await db().visitRequest.updateMany({
    where: { id, deviceHash: null, status: 'approved' },
    data: { deviceHash },
  })
  return r.count === 1
}
