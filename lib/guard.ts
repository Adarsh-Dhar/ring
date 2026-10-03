import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, IS_PROD } from './auth'
import { getResidentEpoch, getDeviceEpoch } from './db/households'
import { getMembershipEpoch } from './db/memberships'
import type { z } from 'zod'
import { getDb } from './db/client'

export const COOKIE = 'db_session'
export const DEVICE_COOKIE = 'db_device'

export type Session = {
  kind: 'helper' | 'resident' | 'device'
  userId: string
  householdId: string
  membershipId?: string
  role?: 'guardian' | 'helper'
}

type Who = 'helper' | 'resident' | 'device' | 'guardian'

const tokenFrom = (req: NextRequest) => {
  const b = req.headers.get('authorization')
  if (b?.startsWith('Bearer ')) return b.slice(7)
  return req.cookies.get(COOKIE)?.value ?? null
}

const deviceTokenFrom = (req: NextRequest) => {
  return req.cookies.get(DEVICE_COOKIE)?.value ?? null
}

/**
 * Resolves the caller from a signed token AND current server state.
 * Revoked tokens (epoch mismatch) return null.
 */
export async function getSession(req: NextRequest): Promise<Session | null> {
  const t = verifyToken(tokenFrom(req))
  if (!t.ok) return null

  const data = t.data

  if (data.kind === 'resident') {
    const epoch = await getResidentEpoch(data.householdId)
    if (data.epoch !== epoch) return null
    return { kind: 'resident', userId: data.sub, householdId: data.householdId }
  }

  if (data.kind === 'helper') {
    const epoch = await getMembershipEpoch(data.sub)
    if (data.epoch !== epoch) return null
    const db = getDb()
    const membership = await db.membership.findUnique({
      where: { id: data.sub },
      include: { user: true, household: true }
    })
    if (!membership || membership.consent !== 'approved') return null
    return {
      kind: 'helper',
      userId: membership.userId,
      householdId: membership.householdId,
      membershipId: membership.id,
      role: membership.role as 'guardian' | 'helper'
    }
  }

  return null
}

/**
 * Resolves a resident device from its device token cookie.
 * Used for the resident pairing page and resident screen.
 */
export async function getDeviceSession(req: NextRequest): Promise<{ householdId: string; deviceId: string } | null> {
  const t = verifyToken(deviceTokenFrom(req))
  if (!t.ok || t.data.kind !== 'device') return null

  const db = getDb()
  const device = await db.residentDevice.findUnique({
    where: { id: t.data.sub },
    include: { household: true }
  })
  if (!device) return null

  const epoch = await getDeviceEpoch(t.data.sub)
  if (t.data.epoch !== epoch) return null

  return { householdId: device.householdId, deviceId: device.id }
}

/** Browsers always send Origin on cross-site POSTs. If it is present it must match our host. */
function sameOrigin(req: NextRequest) {
  const o = req.headers.get('origin')
  if (!o) return true
  try { return new URL(o).host === req.headers.get('host') } catch { return false }
}

export const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })

export type Auth = { ok: true; session: Session | null } | { ok: false; res: NextResponse }

/**
 * Authorizes a request. Returns the session if authenticated and authorized.
 * All authorized sessions must have a householdId - this is used for scoping.
 */
export async function authorize(req: NextRequest, ...allowed: Who[]): Promise<Auth> {
  if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) {
    return { ok: false, res: fail('bad origin', 403) }
  }

  const session = await getSession(req)
  if (!session) {
    return { ok: false, res: fail('Not signed in', 401) }
  }

  // Check role authorization
  let roleOk = false
  if (allowed.includes('guardian') && session.role === 'guardian') roleOk = true
  if (allowed.includes('helper') && session.kind === 'helper') roleOk = true
  if (allowed.includes('resident') && session.kind === 'resident') roleOk = true
  if (allowed.includes('device') && session.kind === 'device') roleOk = true

  if (!roleOk) {
    return { ok: false, res: fail('Forbidden', 403) }
  }

  return { ok: true, session }
}

/**
 * Authorizes a resident device (used for pairing and resident screen).
 * Returns the householdId and deviceId if the device token is valid.
 */
export async function authorizeResident(req: NextRequest): Promise<{ ok: true; householdId: string; deviceId: string } | { ok: false; res: NextResponse }> {
  const device = await getDeviceSession(req)
  if (!device) {
    return { ok: false, res: fail('Device not paired', 401) }
  }
  return { ok: true, ...device }
}

/**
 * Parses and validates a JSON body with a zod schema.
 */
export async function parse<T extends z.ZodTypeAny>(req: NextRequest, schema: T): Promise<{ ok: true; data: z.infer<T> } | { ok: false; res: NextResponse }> {
  let raw: unknown
  try { raw = await req.json() } catch { return { ok: false, res: fail('invalid JSON') } }
  const r = schema.safeParse(raw)
  if (!r.success) return { ok: false, res: fail('invalid request') }
  return { ok: true, data: r.data }
}

export const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, secure: IS_PROD, path: '/', maxAge: 60 * 60 * 24 * 30 }
export const deviceCookieOpts = { httpOnly: true, sameSite: 'lax' as const, secure: IS_PROD, path: '/', maxAge: 60 * 60 * 24 * 365 }
