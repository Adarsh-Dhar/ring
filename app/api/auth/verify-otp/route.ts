import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE, cookieOpts, fail, parse } from '@/lib/guard'
import { makeToken } from '@/lib/auth'
import { getDb } from '@/lib/db/client'
import { normalizePhone, normalizeEmail } from '@/lib/identity'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_ATTEMPTS = 5   // wrong guesses before the code is burnt

function hashOtp(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex')
}

/**
 * POST { email | phone, otp }
 *
 * Verifies the OTP and issues a short-lived "pending" session token.
 * The pending token carries no householdId; the caller must then either:
 *   - POST /api/auth/select-household   (existing user with memberships)
 *   - POST /api/household { action:'create', ... }  (new user / first household)
 *
 * Brute-force protection: each wrong guess increments `attempts` on the
 * OtpCode row.  After MAX_ATTEMPTS wrong guesses the code is marked used
 * and the same generic "Invalid code" response is returned.
 */
export async function POST(req: NextRequest) {
  const p = await parse(req, z.object({
    email: z.string().email().optional(),
    phone: z.string().min(7).max(20).optional(),
    otp:   z.string().length(6).regex(/^\d{6}$/),
  }))
  if (p.ok === false) return p.res

  if (!p.data.email && !p.data.phone) {
    return fail('Email or phone required', 400)
  }

  const db  = getDb()
  const now = new Date()

  // Normalise to the same canonical form used when the code was sent
  const phone = p.data.phone ? normalizePhone(p.data.phone) : null
  const email = p.data.email ? normalizeEmail(p.data.email) : null
  if (p.data.phone && !phone) return fail('Invalid code', 401)

  // Resolve user — same generic error whether address unknown or code wrong
  let userId: string | null = null
  if (email) {
    const u = await db.user.findUnique({ where: { email }, select: { id: true } })
    userId = u?.id ?? null
  } else if (phone) {
    const u = await db.user.findUnique({ where: { phone }, select: { id: true } })
    userId = u?.id ?? null
  }

  if (!userId) return fail('Invalid code', 401)

  // Find the most recent valid (unexpired, unused, under attempt limit) code
  const otpRecord = await db.otpCode.findFirst({
    where: {
      userId,
      used:      false,
      expiresAt: { gt: now },
      attempts:  { lt: MAX_ATTEMPTS },
    },
    orderBy: { createdAt: 'desc' },
  })

  if (!otpRecord) return fail('Invalid code', 401)

  const codeHash = hashOtp(p.data.otp)

  if (otpRecord.codeHash !== codeHash) {
    // Wrong guess — increment attempts; burn the code if limit reached
    const newAttempts = otpRecord.attempts + 1
    await db.otpCode.update({
      where: { id: otpRecord.id },
      data: {
        attempts: newAttempts,
        used:     newAttempts >= MAX_ATTEMPTS,   // burn on final attempt
      },
    })
    return fail('Invalid code', 401)
  }

  // ── Correct code — mark used immediately ─────────────────────────────────
  await db.otpCode.update({
    where: { id: otpRecord.id },
    data:  { used: true },
  })

  // Load memberships for the household-selection screen
  const user = await db.user.findUnique({
    where:  { id: userId },
    select: {
      id:   true,
      name: true,
      memberships: {
        where:   { consent: 'approved' },
        select: {
          id:          true,
          householdId: true,
          role:        true,
          household:   { select: { residentName: true } },
        },
      },
    },
  })

  if (!user) return fail('Invalid code', 401)   // shouldn't happen, but be safe

  // ── Issue a short-lived pending token ─────────────────────────────────────
  // kind='pending', sub=userId, no householdId.
  // Valid for 15 minutes and only accepted by select-household and household create.
  const token = makeToken({
    kind:        'pending',
    sub:         user.id,
    householdId: '',
    epoch:       1,
    exp:         Math.floor(Date.now() / 1000) + 60 * 15,
  })

  if (!token) return fail('Failed to create session', 500)

  const res = NextResponse.json({
    ok:          true,
    name:        user.name,
    memberships: user.memberships.map(m => ({
      id:           m.id,
      householdId:  m.householdId,
      role:         m.role,
      residentName: m.household.residentName,
    })),
  })

  res.cookies.set(COOKIE, token, { ...cookieOpts, maxAge: 60 * 15 })
  return res
}
