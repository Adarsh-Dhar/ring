import { getDb } from "./client"
import type { Consent } from '../doorbell/config'

/**
 * Membership repository functions.
 * These replace the old helper management functions from store.ts.
 */

export async function getMembership(membershipId: string) {
  return getDb().membership.findUnique({
    where: { id: membershipId },
    include: { user: true, household: true }
  })
}

export async function getMembershipsForHousehold(householdId: string) {
  return getDb().membership.findMany({
    where: { householdId },
    include: { user: true },
    orderBy: { position: 'asc' }
  })
}

export async function getApprovedMemberships(householdId: string) {
  return getDb().membership.findMany({
    where: {
      householdId,
      consent: 'approved'
    },
    include: { user: true },
    orderBy: { position: 'asc' }
  })
}

export async function createMembership(data: {
  userId: string
  householdId: string
  role: 'guardian' | 'helper'
  position: number
  emoji?: string
}) {
  return getDb().membership.create({
    data: {
      userId: data.userId,
      householdId: data.householdId,
      role: data.role,
      consent: 'pending',
      position: data.position,
      emoji: data.emoji || '🙂',
      tokenEpoch: 1,
    },
    include: { user: true, household: true }
  })
}

export async function updateMembership(membershipId: string, data: {
  role?: 'guardian' | 'helper'
  position?: number
  emoji?: string
}) {
  return getDb().membership.update({
    where: { id: membershipId },
    data,
    include: { user: true, household: true }
  })
}

export async function setMembershipConsent(membershipId: string, consent: Consent) {
  return getDb().membership.update({
    where: { id: membershipId },
    data: {
      consent,
      consentAt: consent === 'approved' ? new Date() : null,
    },
    include: { user: true, household: true }
  })
}

export async function rotateMembershipEpoch(membershipId: string) {
  return getDb().membership.update({
    where: { id: membershipId },
    data: { tokenEpoch: { increment: 1 } }
  })
}

export async function getMembershipEpoch(membershipId: string): Promise<number> {
  const membership = await getDb().membership.findUnique({
    where: { id: membershipId },
    select: { tokenEpoch: true }
  })
  return membership?.tokenEpoch || 1
}

export async function deleteMembership(membershipId: string) {
  return getDb().membership.delete({
    where: { id: membershipId }
  })
}

export async function moveMembership(membershipId: string, direction: -1 | 1) {
  const membership = await getDb().membership.findUnique({
    where: { id: membershipId },
    select: { position: true, householdId: true }
  })

  if (!membership) return null

  const newPosition = membership.position + direction

  // Swap with the membership at the new position
  const targetMembership = await getDb().membership.findFirst({
    where: {
      householdId: membership.householdId,
      position: newPosition
    }
  })

  if (!targetMembership) return null

  // Swap positions
  await getDb().$transaction([
    getDb().membership.update({
      where: { id: membershipId },
      data: { position: newPosition }
    }),
    getDb().membership.update({
      where: { id: targetMembership.id },
      data: { position: membership.position }
    })
  ])

  return getMembership(membershipId)
}

export async function reorderMemberships(householdId: string, membershipIds: string[]) {
  return getDb().$transaction(
    membershipIds.map((id, index) =>
      getDb().membership.update({
        where: { id },
        data: { position: index }
      })
    )
  )
}
