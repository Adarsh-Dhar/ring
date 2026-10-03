import { getDb } from './client'

/**
 * Household repository functions.
 * These replace the old global state and file-based persistence.
 */

export async function getHousehold(householdId: string) {
  const db = getDb()
  return db.household.findUnique({
    where: { id: householdId },
    include: {
      memberships: {
        include: { user: true },
        orderBy: { position: 'asc' }
      },
      residentDevices: true,
      ringConnections: true,
      devices: true,
    }
  })
}

export async function getApprovedMemberships(householdId: string) {
  const db = getDb()
  return db.membership.findMany({
    where: {
      householdId,
      consent: 'approved'
    },
    include: { user: true },
    orderBy: { position: 'asc' }
  })
}

export async function getMembershipsForHousehold(householdId: string) {
  const db = getDb()
  return db.membership.findMany({
    where: { householdId },
    include: { user: true },
    orderBy: { position: 'asc' }
  })
}

export async function createHousehold(data: {
  residentName: string
  timezone?: string
  timeoutSec?: number
  quietStartHour?: number
  quietEndHour?: number
  quietEnabled?: boolean
  emergencyNumber?: string
}) {
  const db = getDb()
  return db.household.create({
    data: {
      residentName: data.residentName,
      timezone: data.timezone || 'Asia/Kolkata',
      timeoutSec: data.timeoutSec || 30,
      quietStartHour: data.quietStartHour || 22,
      quietEndHour: data.quietEndHour || 6,
      quietEnabled: data.quietEnabled || false,
      emergencyNumber: data.emergencyNumber || '112',
    }
  })
}

export async function updateHousehold(householdId: string, data: {
  residentName?: string
  timezone?: string
  timeoutSec?: number
  quietStartHour?: number
  quietEndHour?: number
  quietEnabled?: boolean
  emergencyNumber?: string
}) {
  const db = getDb()
  return db.household.update({
    where: { id: householdId },
    data
  })
}

export async function rotateResidentEpoch(householdId: string) {
  const db = getDb()
  return db.household.update({
    where: { id: householdId },
    data: { residentEpoch: { increment: 1 } }
  })
}

export async function getResidentEpoch(householdId: string): Promise<number> {
  const db = getDb()
  const household = await db.household.findUnique({
    where: { id: householdId },
    select: { residentEpoch: true }
  })
  return household?.residentEpoch || 1
}

export async function rotateDeviceEpoch(deviceId: string) {
  const db = getDb()
  return db.residentDevice.update({
    where: { id: deviceId },
    data: { deviceTokenEpoch: { increment: 1 } }
  })
}

export async function getDeviceEpoch(deviceId: string): Promise<number> {
  const db = getDb()
  const device = await db.residentDevice.findUnique({
    where: { id: deviceId },
    select: { deviceTokenEpoch: true }
  })
  return device?.deviceTokenEpoch || 1
}

export async function createResidentDevice(householdId: string, pairingCode: string) {
  const db = getDb()
  const crypto = await import('crypto')
  const pairingCodeHash = crypto.createHash('sha256').update(pairingCode).digest('hex')

  return db.residentDevice.create({
    data: {
      householdId,
      pairingCodeHash,
      deviceTokenEpoch: 1,
    }
  })
}

export async function updateResidentDeviceLastSeen(deviceId: string) {
  const db = getDb()
  return db.residentDevice.update({
    where: { id: deviceId },
    data: { lastSeenAt: new Date() }
  })
}

export async function deleteResidentDevice(deviceId: string) {
  const db = getDb()
  return db.residentDevice.delete({
    where: { id: deviceId }
  })
}
