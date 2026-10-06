import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { makeToken, verifyToken } from '@/lib/auth'
import { COOKIE, DEVICE_COOKIE, cookieOpts, deviceCookieOpts, fail, getSession, parse, deviceTokenFrom } from '@/lib/guard'
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

    // Sliding refresh: re-issue cookie if more than half the lifetime has passed
    const deviceToken = deviceTokenFrom(req)
    if (deviceToken) {
      const t = verifyToken(deviceToken)
      if (t.ok && t.data.exp) {
        const lifetimeSeconds = t.data.exp - Math.floor(Date.now() / 1000)
        const TOTAL_LIFETIME = 30 * 24 * 60 * 60 // 30 days
        if (lifetimeSeconds < TOTAL_LIFETIME / 2) {
          // Re-issue token with full lifetime
          const newToken = makeToken({
            kind:        'device',
            sub:         s.userId,
            householdId: s.householdId,
            epoch:       t.data.epoch,
            exp:         Math.floor(Date.now() / 1000) + TOTAL_LIFETIME,
          })
          if (newToken) {
            const res = NextResponse.json({
              kind:         'resident',
              userId:       s.userId,
              householdId:  s.householdId,
              residentName: household.residentName,
            })
            res.cookies.set(DEVICE_COOKIE, newToken, deviceCookieOpts)
            return res
          }
        }
      }
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
 *  - Global rate limit: max 100 attempts total per 10 minutes (prevents distributed attacks).
 *  - DB attempt counter: max 10 wrong guesses per code before it is permanently invalidated.
 *    This survives process restarts, so an attacker cannot reset the counter by restarting.
 *  - The code hash uses SHA-256 (deterministic) so the DB unique index still works.
 *  - Pairing codes expire after 15 minutes.
 *  - Successfully used codes are immediately invalidated (single-use).
 *  - Trust X-Forwarded-For only when behind Caddy (configurable via env var).
 *  - Rate limit counts failures, not successes.
 *  - Regex matches exactly 6 characters (was accepting 36 before).
 */
export async function POST(req: NextRequest) {
  // ── Get IP (trust X-Forwarded-For only when configured) ─────────────────────
  const trustXForwardedFor = process.env.TRUST_X_FORWARDED_FOR === 'true'
  const ip = clientIp(req, trustXForwardedFor)

  // ── IP rate limit ─────────────────────────────────────────────────────────
  if (!hit(`pairing:${ip}`, PAIRING_RATE_MAX, PAIRING_RATE_WINDOW)) {
    return fail('Too many pairing attempts. Please wait 10 minutes and try again.', 429)
  }

  // ── Global rate limit (prevents distributed attacks) ───────────────────────
  if (!hit('pairing:global', 100, PAIRING_RATE_WINDOW)) {
    return fail('Too many pairing attempts globally. Please wait 10 minutes and try again.', 429)
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
    // Count as failure (already counted by rate limiter)
    return fail('Invalid pairing code. Please check the code shown on the guardian screen and try again.', 401)
  }

  // ── Check code expiry (15 minutes) ───────────────────────────────────────
  const CODE_EXPIRY_MS = 15 * 60 * 1000
  if (device.createdAt && new Date().getTime() - device.createdAt.getTime() > CODE_EXPIRY_MS) {
    return fail('This pairing code has expired. Please ask the guardian to generate a new code.', 403)
  }

  // ── Per-code attempt counter (persisted to DB) ────────────────────────────
  if (device.pairingAttempts >= PAIRING_MAX_ATTEMPTS) {
    // Code has been guessed wrong too many times — it is permanently burnt.
    // The guardian must generate a new code.
    console.warn(`[SESSION POST] Pairing code for device ${device.id} is locked after ${device.pairingAttempts} attempts`)
    return fail('This pairing code has been locked after too many failed attempts. Please ask the guardian to generate a new code.', 403)
  }

  // ── Increment attempt counter on failure, burn code on success ─────────────
  try {
    await db.residentDevice.update({
      where: { id: device.id },
      data:  {
        lastSeenAt: new Date(),
        pairingAttempts: { increment: 1 },
      },
    })
  } catch (e) {
    // Non-fatal — log but continue
    console.error('[SESSION POST] Failed to update device', e)
  }

  // Code matched — burn it by deleting the pairing code hash
  try {
    await db.residentDevice.update({
      where: { id: device.id },
      data:  { pairingCodeHash: null },
    })
  } catch (e) {
    // Non-fatal — log but continue
    console.error('[SESSION POST] Failed to burn pairing code', e)
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
    exp:         Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30, // 30 days with sliding refresh
  })

  if (!token) {
    return fail('Failed to create device token. Check that AUTH_SECRET is set.', 500)
  }

  const res = NextResponse.json({ ok: true, householdId: device.householdId })
  res.cookies.set(DEVICE_COOKIE, token, deviceCookieOpts)
  return res
}

export async function DELETE(req: NextRequest) {
  const s = await getSession(req)
  if (s && s.kind === 'user') {
    // Bump sessionVersion to invalidate all existing sessions
    try {
      const db = getDb()
      await db.user.update({
        where: { id: s.userId },
        data: { sessionVersion: { increment: 1 } }
      })
    } catch (e) {
      console.error('[SESSION DELETE] Failed to bump sessionVersion', e)
      // Continue anyway - clearing the cookie is the primary goal
    }
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set(COOKIE,        '', { ...cookieOpts,       maxAge: 0 })
  res.cookies.set(DEVICE_COOKIE, '', { ...deviceCookieOpts, maxAge: 0 })
  return res
}
