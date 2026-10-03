import { getDb } from './client'

/**
 * Test helper functions for creating test data.
 * These should only be used in test environments.
 */

export async function createHousehold(data: {
  residentName: string
  timezone?: string
  timeoutSec?: number
  emergencyNumber?: string
}): Promise<string> {
  const db = getDb()
  const household = await db.household.create({
    data: {
      residentName: data.residentName,
      timezone: data.timezone || 'Asia/Kolkata',
      timeoutSec: data.timeoutSec || 30,
      emergencyNumber: data.emergencyNumber || '112',
    }
  })
  return household.id
}

export async function createMembership(householdId: string, data: {
  role: string
  consent: string
  position: number
  emoji?: string
}) {
  const db = getDb()
  // First create a user
  const user = await db.user.create({
    data: {
      email: `test-${Date.now()}@example.com`,
      name: `Test User ${Date.now()}`,
    }
  })

  return db.membership.create({
    data: {
      userId: user.id,
      householdId,
      role: data.role,
      consent: data.consent,
      position: data.position,
      emoji: data.emoji || '🙂',
    },
    include: { user: true }
  })
}

export async function createCase(householdId: string, data: any) {
  const db = getDb()
  return db.case.create({
    data: {
      householdId,
      ...data
    }
  })
}

export async function createResidentDevice(householdId: string) {
  const db = getDb()
  const crypto = await import('crypto')
  const pairingCode = crypto.randomBytes(4).toString('hex').toUpperCase()
  const codeHash = crypto.createHash('sha256').update(pairingCode).digest('hex')

  return db.residentDevice.create({
    data: {
      householdId,
      pairingCodeHash: codeHash,
      deviceTokenEpoch: 1,
    }
  })
}

export async function cleanupTestData() {
  const db = getDb()
  // Delete in reverse order of dependencies
  await db.case.deleteMany()
  await db.pushSubscription.deleteMany()
  await db.membership.deleteMany()
  await db.invite.deleteMany()
  await db.residentDevice.deleteMany()
  await db.ringConnection.deleteMany()
  await db.device.deleteMany()
  await db.expectedVisit.deleteMany()
  await db.recurringVisit.deleteMany()
  await db.household.deleteMany()
  await db.user.deleteMany()
}
