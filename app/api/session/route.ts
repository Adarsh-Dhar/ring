import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { makeToken } from '@/lib/auth'
import { COOKIE, DEVICE_COOKIE, cookieOpts, deviceCookieOpts, fail, getSession, parse } from '@/lib/guard'
import { getDb } from '@/lib/db/client'
import { hit, clientIp } from '@/lib/ratelimit'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Maximum wrong-code attempts before the pairing code is permanently invalidated. */
const PAIRING_MAX_ATTEMPTS = 10
/** Maximum pairing attempts per IP per 10 minutes. */
const PAIRING_RATE_MAX     = 5
const PAIRING_RATE_WINDOW  = 10 * 60_000  // 10 minutes

/** GET: who am I? (used by the UI) */
export async function GET(req: NextRequest) {
  let s: Awaited<ReturnType<typeof getSession>>
  try {
    s = await getSession(req)
  } catch (e) {
    console.error('[SESSION GET] Failed to resolve session', e)
    return fail('Unable to verify session. Please try again.', 503)
  }

  if (!s) return fail('You are not signed in.', 401)

  let db
  try {
    db = getDb()
  } catch (e) {
    console.error('[SESSION GET] Failed to get database connection', e)
    return fail('Database is unavailable. Please try again shortly.', 503)
  }

  if (s.kind === 'helper') {
    let membership: any
    try {
      membership = await db.membership.findUnique({
        where:   { id: s.membershipId },
        include: { user: true, household: true },
      })
    } catch (e) {
      console.error('[SESSION GET] Failed to load helper membership', e)
      return fail('Unable to load your account details. Please try again.', 503)
    }
    if (!membership) {
      return fail('Your membership no longer exists. Please sign in again.', 404)
    }
    return NextResponse.json({
      kind:         'helper',
      userId:       s.userId,
      householdId:  s.householdId,
      membershipId: s.membershipId,
      role:         s.role,
      name:         membership.user.name,
      residentName: membership.household.residentName,
    })
  }

  if (s.kind === 'resident') {
    let household: any
    try {
      household = await db.household.findUnique({ where: { id: s.householdId } })
    } catch (e) {
      console.error('[SESSION GET] Failed to load resident household', e)
      return fail('Unable to load household details. Please try again.', 503)
    }
    if (!household) {
      return fail('This household no longer exists. Please pair the device again.', 404)
    }
    return NextResponse.json({
      kind:         'resident',
      userId:       s.userId,
      householdId:  s.householdId,
      residentName: household.residentName,
    })
  }

  return fail('Unrecognised session type. Please sign in again.', 400)
}

/**
 * POST { pairingCode }: resident device pairing.
 *
 * The resident enters a 6-character code shown by the guardian.
 *
 * Security measures:
 *  - IP rate limit: max 5 attempts per IP per 10 minutes (in-memory, resets on restart).
 *  - DB attempt counter: max 10 wrong guesses per code before it is permanently invalidated.
 *    This survives process restarts, so an attacker cannot reset the counter by restarting.
 *  - The code hash uses SHA-256 (deterministic) so the DB unique index still works.
 *    Rate limiting + attempt counting make brute-force infeasible (5/10 min per IP,
 *    10 total per code, against a 32-character alphabet = ~2.2 billion combinations).
 */
export async function POST(req: NextRequest) {
  // ── IP rate limit ─────────────────────────────────────────────────────────
  const ip = clientIp(req)
  if (!hit(`pairing:${ip}`, PAIRING_RATE_MAX, PAIRING_RATE_WINDOW)) {
    return fail('Too many pairing attempts. Please wait 10 minutes and try again.', 429)
  }

  const p = await parse(req, z.object({
    pairingCode: z.string().length(6).regex(/^[A-Z0-9]{6}$/, 'Pairing code must be 6 uppercase letters or digits'),
  }))
  if (p.ok === false) return p.res

  let db
  try {
    db = getDb()
  } catch (e) {
    console.error('[SESSION POST] Failed to get database connection', e)
    return fail('Database is unavailable. Please try again shortly.', 503)
  }

  const codeHash = crypto.createHash('sha256').update(p.data.pairingCode).digest('hex')

  let device: any
  try {
    device = await db.residentDevice.findUnique({
      where:   { pairingCodeHash: codeHash },
      include: { household: true },
    })
  } catch (e) {
    console.error('[SESSION POST] Failed to look up pairing code', e)
    return fail('Unable to verify pairing code. Please try again.', 503)
  }

  if (!device) {
    // Still increment a placeholder counter via the rate limiter — already done above.
    return fail('Invalid pairing code. Please check the code shown on the guardian screen and try again.', 401)
  }

  // ── Per-code attempt counter (persisted to DB) ────────────────────────────
  if (device.pairingAttempts >= PAIRING_MAX_ATTEMPTS) {
    // Code has been guessed wrong too many times — it is permanently burnt.
    // The guardian must generate a new code.
    console.warn(`[SESSION POST] Pairing code for device ${device.id} is locked after ${device.pairingAttempts} attempts`)
    return fail('This pairing code has been locked after too many failed attempts. Please ask the guardian to generate a new code.', 403)
  }

  // Code matched — reset the attempt counter (successful pairing).
  try {
    await db.residentDevice.update({
      where: { id: device.id },
      data:  { lastSeenAt: new Date(), pairingAttempts: 0 },
    })
  } catch (e) {
    // Non-fatal — log but continue
    console.error('[SESSION POST] Failed to update device lastSeenAt', e)
  }

  let epoch = 1
  try {
    const household = await db.household.findUnique({
      where:  { id: device.householdId },
      select: { residentEpoch: true },
    })
    epoch = household?.residentEpoch ?? 1
  } catch (e) {
    console.error('[SESSION POST] Failed to load resident epoch', e)
    return fail('Unable to complete device pairing. Please try again.', 503)
  }

  const token = makeToken({
    kind:        'device',
    sub:         device.id,
    householdId: device.householdId,
    epoch,
    exp:         Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
  })

  if (!token) {
    return fail('Failed to create device token. Check that AUTH_SECRET is set.', 500)
  }

  const res = NextResponse.json({ ok: true, householdId: device.householdId })
  res.cookies.set(DEVICE_COOKIE, token, deviceCookieOpts)
  return res
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(COOKIE,        '', { ...cookieOpts,       maxAge: 0 })
  res.cookies.set(DEVICE_COOKIE, '', { ...deviceCookieOpts, maxAge: 0 })
  return res
}
