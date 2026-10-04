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
  return getDb().pushSubscription.findMany({
    where: { membershipId }
  })
}

export async function getPushSubscriptionsForHousehold(householdId: string) {
  const memberships = await getDb().membership.findMany({
    where: {
      householdId,
      consent: 'approved'
    },
    select: { id: true }
  })

  const membershipIds = memberships.map((m) => m.id)

  return getDb().pushSubscription.findMany({
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
