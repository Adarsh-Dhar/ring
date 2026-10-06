import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, IS_PROD } from './auth'
import { getResidentEpoch, getDeviceEpoch } from './db/households'
import { getMembershipEpoch } from './db/memberships'
import type { z } from 'zod'
import { getDb } from './db/client'

export const COOKIE = 'db_session'
export const DEVICE_COOKIE = 'db_device'
export const HOUSEHOLD_COOKIE = 'db_household'

export type Session = {
  kind: 'user' | 'resident' | 'device' | 'helper'
  userId: string
  householdId: string
  membershipId?: string
  role?: 'guardian' | 'helper'
}

type Who = 'helper' | 'resident' | 'device' | 'guardian' | 'any' | 'user'

const tokenFrom = (req: NextRequest) => {
  const b = req.headers.get('authorization')
  if (b?.startsWith('Bearer ')) return b.slice(7)
  return req.cookies.get(COOKIE)?.value ?? null
}

export const deviceTokenFrom = (req: NextRequest) => {
  return req.cookies.get(DEVICE_COOKIE)?.value ?? null
}

/**
 * Resolves the caller from a signed token AND current server state.
 * Revoked tokens (epoch mismatch or sessionVersion mismatch) return null.
 * For user sessions, roles are resolved from the database.
 */
export async function getSession(req: NextRequest): Promise<Session | null> {
  const t = verifyToken(tokenFrom(req))
  if (t.ok === false) return residentFromDevice(req)

  const data = t.data

  // Only 'user' and 'resident' kinds are valid for human sessions
  if (data.kind === 'user') {
    const db = getDb()
    const user = await db.user.findUnique({
      where: { id: data.sub },
      select: { id: true, sessionVersion: true }
    })

    if (!user) return null
    if (data.sessionVersion !== user.sessionVersion) return null

    return {
      kind: 'user',
      userId: data.sub,
      householdId: data.householdId || '',
    }
  }

  if (data.kind === 'resident') {
    if (!data.householdId) return null
    const epoch = await getResidentEpoch(data.householdId)
    if (data.epoch !== epoch) return null
    return { kind: 'resident', userId: data.sub, householdId: data.householdId }
  }

  return null
}

/**
 * A paired resident screen only has the db_device cookie (POST /api/session). Treat it as a resident session,
 * so /api/doorbell/state, /verify and the regular-visitor approvals work from that screen.
 * The token's epoch is the household's residentEpoch (that is what /api/session signs), and the device row must still exist.
 */
async function residentFromDevice(req: NextRequest): Promise<Session | null> {
  const t = verifyToken(deviceTokenFrom(req))
  if (t.ok === false || t.data.kind !== 'device') return null
  if (!t.data.householdId) return null
  const device = await getDb().residentDevice.findUnique({
    where: { id: t.data.sub },
    include: { household: { select: { residentEpoch: true } } }
  })
  if (!device || device.householdId !== t.data.householdId) return null
  // Compare token epoch with household's residentEpoch
  if (t.data.epoch !== device.household.residentEpoch) return null
  return { kind: 'resident', userId: t.data.sub, householdId: device.householdId }
}

/**
 * Returns the userId from a user session.
 * Used by routes that need the current user.
 */
export async function getUserId(req: NextRequest): Promise<string | null> {
  const session = await getSession(req)
  return session?.userId ?? null
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

/**
 * v2: Resolves a v2 device session from the session cookie.
 * Supports device-based authentication for residents, helpers, and guardians.
 */
export async function getV2DeviceSession(req: NextRequest): Promise<{
  deviceId: string
  householdId: string
  membershipId?: string
  kind: 'resident' | 'helper' | 'guardian' | 'visitor'
} | null> {
  const t = verifyToken(tokenFrom(req))
  if (!t.ok) return null

  const data = t.data

  // v2 device sessions have deviceId as 'sub' and kind indicating device type
  if (!['resident', 'helper', 'guardian', 'visitor'].includes(data.kind)) {
    return null
  }

  const db = getDb()
  const device = await db.v2Device.findUnique({
    where: { id: data.sub },
    include: { membership: true, household: true },
  })

  if (!device) return null
  if (device.revokedAt) return null
  if (device.householdId !== data.householdId) return null

  // Reject token whose kind differs from the device's kind
  if (device.kind !== data.kind) return null

  // Reject helper and guardian devices whose membership isn't approved
  if ((device.kind === 'helper' || device.kind === 'guardian') && device.memberId) {
    const membership = await db.membership.findUnique({
      where: { id: device.memberId },
      select: { consent: true }
    })
    if (!membership || membership.consent !== 'approved') return null
  }

  // Check session expiry (90 days from last seen)
  const SESSION_DURATION = 90 * 24 * 60 * 60 * 1000
  const sessionExpiry = new Date(device.lastSeenAt.getTime() + SESSION_DURATION)
  if (new Date() > sessionExpiry) return null

  return {
    deviceId: device.id,
    householdId: device.householdId,
    membershipId: device.memberId ?? undefined,
    kind: device.kind as 'resident' | 'helper' | 'guardian' | 'visitor',
  }
}

/** Browsers always send Origin on cross-site POSTs. If it is present it must match our host. */
export function sameOrigin(req: NextRequest) {
  const o = req.headers.get('origin')
  if (!o) return true
  try { return new URL(o).host === req.headers.get('host') } catch { return false }
}

/** Wrap an async route handler so unhandled exceptions return a 500 instead of crashing silently. */
export function withErrorHandling(
  handler: (req: NextRequest, ctx?: any) => Promise<NextResponse | Response>
) {
  return async (req: NextRequest, ctx?: any) => {
    try {
      return await handler(req, ctx)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'An unexpected error occurred'
      console.error('[API ERROR]', req.method, req.nextUrl.pathname, e)
      return fail('Something went wrong. Please try again.', 500)
    }
  }
}

export const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })

/** Format zod issues into a single human-readable string, e.g. "email: Invalid email; otp: Required" */
function formatZodErrors(issues: { path: (string | number | symbol)[]; message: string }[]): string {
  return issues
    .map(i => (i.path.length ? `${i.path.map(String).join('.')}: ${i.message}` : i.message))
    .join('; ')
}

export type Auth = { ok: true; session: Session } | { ok: false; res: NextResponse }
export type ParseResult<T> = { ok: true; data: T } | { ok: false; res: NextResponse }

/** Type-narrowing helper – avoids issues with `!x.ok` not narrowing in some TS configs. */
export function isAuthOk(a: Auth): a is { ok: true; session: Session } { return a.ok }
export function isParseOk<T>(p: ParseResult<T>): p is { ok: true; data: T } { return p.ok }

/**
 * Authorizes a request. Returns the session if authenticated and authorized.
 * For user sessions, loads the user's membership for the target household and checks the role.
 * Supports both old-style cookie sessions and new v2 device sessions.
 */
export async function authorize(req: NextRequest, ...allowed: Who[]): Promise<Auth> {
  if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) {
    return { ok: false as const, res: fail('Cross-origin requests are not allowed', 403) }
  }

  // Try v2 device session first
  const v2Session = await getV2DeviceSession(req)
  if (v2Session) {
    // Visitor devices are only allowed on routes that explicitly allow 'device'
    if (v2Session.kind === 'visitor' && !allowed.includes('device')) {
      return { ok: false as const, res: fail('Visitor devices cannot access this endpoint', 403) }
    }

    // Convert v2 device session to old-style Session format for compatibility
    let role: 'guardian' | 'helper' | undefined
    if (v2Session.kind === 'guardian') role = 'guardian'
    if (v2Session.kind === 'helper') role = 'helper'

    // Visitor devices get their own kind, not mapped to helper
    const session: Session = {
      kind: v2Session.kind === 'visitor' ? 'device' : (v2Session.kind === 'resident' ? 'resident' : 'helper'),
      userId: v2Session.deviceId,
      householdId: v2Session.householdId,
      membershipId: v2Session.membershipId,
      role,
    }

    // Check role authorization
    let roleOk = false
    if (allowed.includes('any')) roleOk = true
    if (allowed.includes('user') && session.kind === 'user') roleOk = true
    if (allowed.includes('guardian') && session.role === 'guardian') roleOk = true
    if (allowed.includes('helper') && session.kind === 'helper') roleOk = true
    if (allowed.includes('resident') && session.kind === 'resident') roleOk = true
    if (allowed.includes('device') && v2Session.kind === 'visitor') roleOk = true

    if (!roleOk) {
      return { ok: false as const, res: fail('Forbidden', 403) }
    }

    return { ok: true as const, session }
  }

  // Fall back to old-style session
  const session = await getSession(req)
  if (!session) {
    return { ok: false as const, res: fail('Not signed in', 401) }
  }

  // For user sessions, resolve role from database membership
  if (session.kind === 'user') {
    // Resolve householdId in order: session, cookie, single membership
    let targetHouseholdId = session.householdId

    if (!targetHouseholdId) {
      // Try cookie
      const householdCookie = req.cookies.get(HOUSEHOLD_COOKIE)?.value
      if (householdCookie) {
        targetHouseholdId = householdCookie
      }
    }

    if (!targetHouseholdId) {
      // Try single approved membership
      const db = getDb()
      const memberships = await db.membership.findMany({
        where: {
          userId: session.userId,
          consent: 'approved',
        },
        select: { householdId: true },
      })

      if (memberships.length === 1) {
        targetHouseholdId = memberships[0].householdId
      } else {
        return { ok: false as const, res: fail('Select a household first', 400) }
      }
    }

    // If 'any' or 'user' is allowed, return without checking role
    if (allowed.includes('any') || allowed.includes('user')) {
      return { ok: true as const, session: { ...session, householdId: targetHouseholdId } }
    }

    // Otherwise, we need to check membership for the target household
    const db = getDb()
    const membership = await db.membership.findFirst({
      where: {
        userId: session.userId,
        householdId: targetHouseholdId,
        consent: 'approved',
      },
      select: { role: true, id: true }
    })

    if (!membership) {
      return { ok: false as const, res: fail('You are not a member of this household', 403) }
    }

    // Check role authorization
    let roleOk = false
    if (allowed.includes('guardian') && membership.role === 'guardian') roleOk = true
    if (allowed.includes('helper') && membership.role === 'helper') roleOk = true

    if (!roleOk) {
      return { ok: false as const, res: fail('Forbidden', 403) }
    }

    // Augment session with role and membershipId
    session.role = membership.role as 'guardian' | 'helper'
    session.membershipId = membership.id
    session.householdId = targetHouseholdId
  }

  // Check role authorization for resident sessions
  if (session.kind === 'resident') {
    let roleOk = false
    if (allowed.includes('any')) roleOk = true
    if (allowed.includes('resident')) roleOk = true

    if (!roleOk) {
      return { ok: false as const, res: fail('Forbidden', 403) }
    }
  }

  return { ok: true as const, session }
}

/**
 * Authorizes a resident device (used for pairing and resident screen).
 * Returns the householdId and deviceId if the device token is valid.
 */
export async function authorizeResident(req: NextRequest): Promise<{ ok: true; householdId: string; deviceId: string } | { ok: false; res: NextResponse }> {
  const device = await getDeviceSession(req)
  if (!device) {
    return { ok: false as const, res: fail('Device not paired', 401) }
  }
  return { ok: true as const, ...device }
}

/**
 * Parses and validates a JSON body with a zod schema.
 */
export async function parse<T extends z.ZodTypeAny>(req: NextRequest, schema: T): Promise<{ ok: true; data: z.infer<T> } | { ok: false; res: NextResponse }> {
  let raw: unknown
  try { raw = await req.json() } catch { return { ok: false as const, res: fail('Request body must be valid JSON') } }
  const r = schema.safeParse(raw)
  if (!r.success) {
    const msg = formatZodErrors(r.error.issues)
    return { ok: false as const, res: fail(`Validation error: ${msg}`) }
  }
  return { ok: true as const, data: r.data }
}

export const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, secure: IS_PROD, path: '/', maxAge: 60 * 60 * 24 * 30 }
export const deviceCookieOpts = { httpOnly: true, sameSite: 'lax' as const, secure: IS_PROD, path: '/', maxAge: 60 * 60 * 24 * 365 }
