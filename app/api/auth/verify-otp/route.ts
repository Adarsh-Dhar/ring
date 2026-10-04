import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE, cookieOpts, fail, parse } from '@/lib/guard'
import { makeToken } from '@/lib/auth'
import { getDb } from '@/lib/db/client'
import { normalizePhone, normalizeEmail } from '@/lib/identity'
import { hit, clientIp } from '@/lib/ratelimit'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_ATTEMPTS_PER_CODE = 5          // per IP per code
const MAX_GLOBAL_ATTEMPTS_PER_CODE = 10 // across all IPs per code
const OTP_VERIFY_RATE_LIMIT_WINDOW = 10 * 60 * 1000 // 10 minutes

function hashOtp(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex')
}

export async function POST(req: NextRequest) {
  const p = await parse(req, z.object({
    email: z.string().email().optional(),
    phone: z.string().min(7).max(20).optional(),
    otp:   z.string().length(6).regex(/^\d{6}$/, 'OTP must be exactly 6 digits'),
  }))
  if (p.ok === false) return p.res

  if (!p.data.email && !p.data.phone) {
    return fail('Please provide either an email address or a phone number', 400)
  }

  // IP-based rate limiting to prevent OTP brute force
  const ip = clientIp(req)
  if (!hit(`otp-verify:${ip}`, MAX_ATTEMPTS_PER_CODE, OTP_VERIFY_RATE_LIMIT_WINDOW)) {
    return fail('Too many verification attempts. Please wait a few minutes.', 429)
  }

  let db
  try {
    db = getDb()
  } catch (e) {
    console.error('[VERIFY-OTP] Failed to get database connection', e)
    return fail('Database is unavailable. Please try again shortly.', 503)
  }

  const now   = new Date()
  const phone = p.data.phone ? normalizePhone(p.data.phone) : null
  const email = p.data.email ? normalizeEmail(p.data.email) : null
  if (p.data.phone && !phone) {
    return fail(`"${p.data.phone}" is not a valid phone number`, 400)
  }

  let userId: string | null = null
  try {
    if (email) {
      const u = await db.user.findUnique({ where: { email }, select: { id: true } })
      userId = u?.id ?? null
    } else if (phone) {
      const u = await db.user.findUnique({ where: { phone }, select: { id: true } })
      userId = u?.id ?? null
    }
  } catch (e) {
    console.error('[VERIFY-OTP] Failed to look up user', e)
    return fail('Unable to verify sign-in code. Please try again.', 503)
  }

  // Use a generic message — never reveal whether the address is registered
  if (!userId) return fail('Incorrect or expired sign-in code', 401)

  let otpRecord: { id: string; codeHash: string; attempts: number } | null = null
  try {
    otpRecord = await db.otpCode.findFirst({
      where: {
        userId,
        used:      false,
        expiresAt: { gt: now },
        attempts:  { lt: MAX_GLOBAL_ATTEMPTS_PER_CODE },
      },
      orderBy: { createdAt: 'desc' },
    })
  } catch (e) {
    console.error('[VERIFY-OTP] Failed to look up OTP record', e)
    return fail('Unable to verify sign-in code. Please try again.', 503)
  }

  if (!otpRecord) {
    return fail('Sign-in code has expired or has already been used. Please request a new one.', 401)
  }

  const codeHash = hashOtp(p.data.otp)

  if (otpRecord.codeHash !== codeHash) {
    const newAttempts = otpRecord.attempts + 1
    const remaining   = MAX_GLOBAL_ATTEMPTS_PER_CODE - newAttempts

    try {
      await db.otpCode.update({
        where: { id: otpRecord.id },
        data: {
          attempts: newAttempts,
          used:     newAttempts >= MAX_GLOBAL_ATTEMPTS_PER_CODE,
        },
      })
    } catch (e) {
      console.error('[VERIFY-OTP] Failed to increment attempt count', e)
    }

    if (newAttempts >= MAX_GLOBAL_ATTEMPTS_PER_CODE) {
      return fail('Too many incorrect attempts. Please request a new sign-in code.', 401)
    }
    return fail(
      `Incorrect sign-in code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
      401
    )
  }

  try {
    await db.otpCode.update({
      where: { id: otpRecord.id },
      data:  { used: true },
    })
  } catch (e) {
    console.error('[VERIFY-OTP] Failed to mark OTP as used', e)
    return fail('Unable to complete sign-in. Please try again.', 503)
  }

  let user: {
    id: string
    name: string | null
    memberships: {
      id: string
      householdId: string
      role: string
      household: { residentName: string }
    }[]
  } | null = null

  try {
    user = await db.user.findUnique({
      where:  { id: userId },
      select: {
        id:   true,
        name: true,
        memberships: {
          where:  { consent: 'approved' },
          select: {
            id:          true,
            householdId: true,
            role:        true,
            household:   { select: { residentName: true } },
          },
        },
      },
    })
  } catch (e) {
    console.error('[VERIFY-OTP] Failed to load user memberships', e)
    return fail('Sign-in succeeded but could not load your account. Please try again.', 503)
  }

  if (!user) {
    return fail('Account not found. Please contact support.', 404)
  }

  const token = makeToken({
    kind:        'pending',
    sub:         user.id,
    householdId: '',
    epoch:       1,
    exp:         Math.floor(Date.now() / 1000) + 60 * 15,
  })

  if (!token) {
    return fail('Failed to create session token. Check that AUTH_SECRET is set.', 500)
  }

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
