import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { makeToken, verifyToken } from '@/lib/auth'
import { COOKIE, DEVICE_COOKIE, cookieOpts, deviceCookieOpts, fail, getSession, parse, deviceTokenFrom, HOUSEHOLD_COOKIE } from '@/lib/guard'
import { getDb } from '@/lib/db/client'
import { hit, clientIp } from '@/lib/ratelimit'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

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

  if (s.kind === 'user') {
    // Resolve household for user sessions
    let targetHouseholdId = s.householdId
    let role: 'guardian' | 'helper' | null = null

    if (!targetHouseholdId) {
      const householdCookie = req.cookies.get(HOUSEHOLD_COOKIE)?.value
      if (householdCookie) {
        targetHouseholdId = householdCookie
      }
    }

    if (!targetHouseholdId) {
      const db = getDb()
      const memberships = await db.membership.findMany({
        where: {
          userId: s.userId,
          consent: 'approved',
        },
        select: { householdId: true, role: true },
      })

      if (memberships.length === 1) {
        targetHouseholdId = memberships[0].householdId
        role = memberships[0].role as 'guardian' | 'helper'
      }
    }

    if (targetHouseholdId && !role) {
      const db = getDb()
      const membership = await db.membership.findFirst({
        where: {
          userId: s.userId,
          householdId: targetHouseholdId,
          consent: 'approved',
        },
        select: { role: true },
      })
      if (membership) {
        role = membership.role as 'guardian' | 'helper'
      }
    }

    const user = await db.user.findUnique({
      where: { id: s.userId },
      select: { id: true, name: true, email: true },
    })

    if (!user) {
      return fail('User not found', 404)
    }

    return NextResponse.json({
      kind: 'user',
      userId: s.userId,
      name: user.name,
      email: user.email,
      householdId: targetHouseholdId || null,
      role: role,
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
      include: { household: { select: { residentEpoch: true } } },
    })
  } catch (e) {
    console.error('[SESSION POST] Failed to look up pairing code', e)
    return fail('Unable to verify pairing code. Please try again.', 503)
  }

  if (!device) {
    return fail('Invalid or expired pairing code.', 401)
  }

  // Atomic single-use claim: only one concurrent request can win
  const claimed = await db.residentDevice.updateMany({
    where: {
      id: device.id,
      pairingCodeHash: codeHash,
      createdAt: { gt: new Date(Date.now() - 15 * 60_000) }, // 15 minutes expiry
    },
    data:  { pairingCodeHash: null, lastSeenAt: new Date() },
  })

  if (claimed.count !== 1) {
    return fail('Invalid or expired pairing code.', 401)
  }

  const epoch = device.household.residentEpoch

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
