/**
 * Visitor pass service
 * Creation, listing, revocation and the Prisma-backed store for device binding.
 * The secret/binding rules themselves live in ./binding (no database imports, unit-tested).
 */

import { getDb } from '@/lib/db/client'
import { newSecret } from '@/lib/visit-tokens'
import { sha256, type PassStore } from './binding'

export interface CreatePassOptions {
  householdId: string
  visitorName: string
  windowStart: Date
  windowEnd: Date
  recurrence?: any
}

/** What clients may see. Never includes secretHash or boundDeviceHash. */
export interface PassWithEvents {
  id: string
  householdId: string
  visitorName: string
  windowStart: Date
  windowEnd: Date
  recurrence: any
  bound: boolean
  boundAt: Date | null
  revokedAt: Date | null
  createdAt: Date
  events?: { id: string; passId: string; type: string; at: Date }[]
}

const PUBLIC_SELECT = {
  id: true, householdId: true, visitorName: true, windowStart: true, windowEnd: true,
  recurrence: true, boundDeviceHash: true, boundAt: true, revokedAt: true, createdAt: true,
} as const

function toPublic<T extends { boundDeviceHash: string | null }>(row: T): Omit<T, 'boundDeviceHash'> & { bound: boolean } {
  const { boundDeviceHash, ...rest } = row
  return { ...rest, bound: !!boundDeviceHash }
}

/** Create a pass. The returned `secret` is shown once (it goes into the visitor link); only its hash is stored. */
export async function createPass(options: CreatePassOptions): Promise<{ pass: PassWithEvents; secret: string }> {
  const db = getDb()
  const secret = newSecret()

  const row = await db.pass.create({
    data: {
      householdId: options.householdId,
      visitorName: options.visitorName,
      windowStart: options.windowStart,
      windowEnd: options.windowEnd,
      recurrence: options.recurrence ?? undefined,
      secretHash: sha256(secret),
    },
    select: PUBLIC_SELECT,
  })

  await db.passEvent.create({ data: { passId: row.id, type: 'created', deviceId: null } })
  return { pass: toPublic(row) as PassWithEvents, secret }
}

export async function getPassesForHousehold(householdId: string): Promise<PassWithEvents[]> {
  const rows = await getDb().pass.findMany({
    where: { householdId },
    select: { ...PUBLIC_SELECT, events: { orderBy: { at: 'desc' }, select: { id: true, passId: true, type: true, at: true } } },
    orderBy: { createdAt: 'desc' },
  })
  return rows.map(toPublic) as PassWithEvents[]
}

export async function getPassById(passId: string, householdId: string): Promise<PassWithEvents | null> {
  const row = await getDb().pass.findFirst({
    where: { id: passId, householdId },
    select: { ...PUBLIC_SELECT, events: { orderBy: { at: 'desc' }, select: { id: true, passId: true, type: true, at: true } } },
  })
  return row ? (toPublic(row) as PassWithEvents) : null
}

/** Revoke a pass that belongs to this household. Returns null if there is no such pass here. */
export async function revokePass(passId: string, householdId: string): Promise<PassWithEvents | null> {
  const db = getDb()
  const r = await db.pass.updateMany({ where: { id: passId, householdId, revokedAt: null }, data: { revokedAt: new Date() } })
  if (r.count === 0) {
    // Already revoked is fine (idempotent); wrong household or unknown id is not.
    return getPassById(passId, householdId)
  }
  await db.passEvent.create({ data: { passId, type: 'revoked', deviceId: null } })
  return getPassById(passId, householdId)
}

/** Prisma implementation of the store used by useVisitorPass(). */
export const prismaPassStore: PassStore = {
  async findBySecretHash(secretHash) {
    return getDb().pass.findUnique({
      where: { secretHash },
      select: { id: true, householdId: true, windowStart: true, windowEnd: true, revokedAt: true, boundDeviceHash: true },
    })
  },
  async bindIfUnbound(passId, deviceHash) {
    const r = await getDb().pass.updateMany({
      where: { id: passId, boundDeviceHash: null },
      data:  { boundDeviceHash: deviceHash, boundAt: new Date() },
    })
    return r.count === 1
  },
  async boundHash(passId) {
    const p = await getDb().pass.findUnique({ where: { id: passId }, select: { boundDeviceHash: true } })
    return p?.boundDeviceHash ?? null
  },
  async recordEvent(passId, type, deviceHash) {
    // Only a short fingerprint is kept in the audit log, never the full hash.
    await getDb().passEvent.create({ data: { passId, type, deviceId: deviceHash ? deviceHash.slice(0, 12) : null } })
  },
}

