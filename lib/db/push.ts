import { getDb } from "./client"

/**
 * Push subscription repository functions.
 * These replace the in-memory push subscription storage.
 */

export async function createPushSubscription(membershipId: string, endpoint: string, keys: { p256dh: string; auth: string }) {
  return getDb().pushSubscription.create({
    data: {
      membershipId,
      endpoint,
      keys,
    }
  })
}

export async function getPushSubscriptionsForMembership(membershipId: string) {
  const db = getDb()
  if (!db?.pushSubscription?.findMany) return []
  return db.pushSubscription.findMany({
    where: { membershipId }
  })
}

export async function getPushSubscriptionsForHousehold(householdId: string) {
  const db = getDb()
  if (!db?.membership?.findMany || !db?.pushSubscription?.findMany) return []
  const memberships = await db.membership.findMany({
    where: {
      householdId,
      consent: 'approved'
    },
    select: { id: true }
  })

  const membershipIds = memberships.map((m) => m.id)

  return db.pushSubscription.findMany({
    where: {
      membershipId: { in: membershipIds }
    }
  })
}

export async function deletePushSubscription(id: string) {
  return getDb().pushSubscription.delete({
    where: { id }
  })
}

export async function deletePushSubscriptionByEndpoint(membershipId: string, endpoint: string) {
  return getDb().pushSubscription.deleteMany({
    where: {
      membershipId,
      endpoint
    }
  })
}
