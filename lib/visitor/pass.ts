/**
 * Visitor pass service
 * Manages visitor pass creation, validation, and audit logging
 */

import { getDb } from '@/lib/db/client'

export interface CreatePassOptions {
  householdId: string
  visitorName: string
  windowStart: Date
  windowEnd: Date
  recurrence?: any
  deviceId?: string
}

export interface PassWithEvents {
  id: string
  householdId: string
  visitorName: string
  windowStart: Date
  windowEnd: Date
  recurrence: any
  deviceId: string | null
  revokedAt: Date | null
  createdAt: Date
  events: {
    id: string
    passId: string
    type: 'created' | 'used' | 'revoked'
    deviceId: string | null
    at: Date
  }[]
}

/**
 * Create a new visitor pass
 */
export async function createPass(options: CreatePassOptions): Promise<PassWithEvents> {
  const db = getDb()

  const pass = await db.pass.create({
    data: {
      householdId: options.householdId,
      visitorName: options.visitorName,
      windowStart: options.windowStart,
      windowEnd: options.windowEnd,
      recurrence: options.recurrence || null,
      deviceId: options.deviceId || null,
    },
  })

  // Audit log: created
  await db.passEvent.create({
    data: {
      passId: pass.id,
      type: 'created',
      deviceId: options.deviceId || null,
    },
  })

  return pass as PassWithEvents
}

/**
 * Get all passes for a household
 */
export async function getPassesForHousehold(householdId: string): Promise<PassWithEvents[]> {
  const db = getDb()

  const passes = await db.pass.findMany({
    where: { householdId },
    include: {
      events: {
        orderBy: { id: 'desc' },
      },
    },
    orderBy: { id: 'desc' },
  })

  return passes as PassWithEvents[]
}

/**
 * Get a specific pass by ID
 */
export async function getPassById(passId: string, householdId: string): Promise<PassWithEvents | null> {
  const db = getDb()

  const pass = await db.pass.findFirst({
    where: {
      id: passId,
      householdId,
    },
    include: {
      events: {
        orderBy: { id: 'desc' },
      },
    },
  })

  return pass as PassWithEvents | null
}

/**
 * Revoke a pass
 */
export async function revokePass(passId: string, householdId: string): Promise<PassWithEvents> {
  const db = getDb()

  const pass = await db.pass.update({
    where: { id: passId },
    data: { revokedAt: new Date() },
  })

  // Audit log: revoked
  await db.passEvent.create({
    data: {
      passId: pass.id,
      type: 'revoked',
      deviceId: null,
    },
  })

  return pass as PassWithEvents
}

/**
 * Validate if a pass is currently valid
 */
export function isPassValid(pass: PassWithEvents): boolean {
  const now = new Date()

  // Check if revoked
  if (pass.revokedAt) {
    return false
  }

  // Check time window
  if (now < pass.windowStart || now > pass.windowEnd) {
    return false
  }

  return true
}

/**
 * Record a pass usage event
 */
export async function recordPassUsage(passId: string, deviceId: string): Promise<void> {
  const db = getDb()

  await db.passEvent.create({
    data: {
      passId,
      type: 'used',
      deviceId,
    },
  })
}
