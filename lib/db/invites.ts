import { getDb } from "./client"

/**
 * Invite repository functions.
 */

export async function createInvite(data: {
  householdId: string
  role: string
  createdByUserId: string
  expiresAt?: Date
}) {
  const db = getDb()
  const crypto = await import('crypto')
  const code = crypto.randomBytes(6).toString('base64url').substring(0, 8).toUpperCase()

  return db.invite.create({
    data: {
      code,
      householdId: data.householdId,
      role: data.role,
      createdByUserId: data.createdByUserId,
      expiresAt: data.expiresAt,
    }
  })
}

export async function getInvite(code: string) {
  const db = getDb()
  return db.invite.findUnique({
    where: { code },
    include: { household: true, createdBy: true }
  })
}

export async function acceptInvite(inviteId: string, acceptedByUserId: string) {
  const db = getDb()
  return db.invite.update({
    where: { id: inviteId },
    data: { status: 'accepted', acceptedByUserId }
  })
}

export async function deleteInvite(id: string) {
  const db = getDb()
  return db.invite.delete({ where: { id } })
}

export async function getInvitesForHousehold(householdId: string) {
  const db = getDb()
  return db.invite.findMany({
    where: { householdId },
    include: { createdBy: true },
    orderBy: { createdAt: 'desc' }
  })
}
