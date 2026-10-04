import { getDb } from './client'

const db = () => getDb()

// ── counts for rate-limiting ───────────────────────────────────────────────────
export const countByIp      = (ip: string, since: Date) =>
  db().regularVisitor.count({ where: { ip, createdAt: { gte: since } } })
export const countByContact = (householdId: string, contact: string, since: Date) =>
  db().regularVisitor.count({ where: { householdId, contact, createdAt: { gte: since } } })
export const countByLink    = (linkId: string, since: Date) =>
  db().regularVisitor.count({ where: { linkId, createdAt: { gte: since } } })
export const countPending   = (householdId: string) =>
  db().regularVisitor.count({ where: { householdId, status: 'pending', expiresAt: { gt: new Date() } } })

// ── rows ───────────────────────────────────────────────────────────────────────
export const create = (data: any) => db().regularVisitor.create({ data })

export const getById = (householdId: string, id: string) =>
  db().regularVisitor.findFirst({ where: { id, householdId } })

export const getByToken = (statusToken: string) =>
  db().regularVisitor.findUnique({ where: { statusToken } })

export const update = (id: string, data: any) =>
  db().regularVisitor.update({ where: { id }, data })

export const list = (householdId: string, statuses: string[], limit = 50) =>
  db().regularVisitor.findMany({
    where: { householdId, status: { in: statuses } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

export const findExpirable = (householdId: string, now: Date) =>
  db().regularVisitor.findMany({ where: { householdId, status: 'pending', expiresAt: { lte: now } } })

export const listPendingForHousehold = (householdId: string) =>
  db().regularVisitor.findMany({ where: { householdId, status: 'pending' } })

/** Atomic state change. Returns false when the row was not in one of the `from` states. */
export async function transition(id: string, from: string[], data: any): Promise<boolean> {
  const r = await db().regularVisitor.updateMany({ where: { id, status: { in: from } }, data })
  return r.count === 1
}

/** What a closed registration keeps: no photo, no face numbers. */
export const PURGE = { photoEnc: null, embedding: null } as const
