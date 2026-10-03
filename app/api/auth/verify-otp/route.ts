import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE, cookieOpts, fail, parse } from '@/lib/guard'
import { makeToken } from '@/lib/auth'
import { getDb } from '@/lib/db/client'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function hashOtp(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex')
}

/**
 * POST { email | phone, otp }
 *
 * Verifies the OTP and issues a short-lived "pending" session token.
 * The pending token has no householdId; the caller must POST to
 * /api/auth/select-household to exchange it for a full session token.
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

  const db = getDb()

  // Resolve user
  let user: { id: string; name: string | null; memberships: Array<{ id: string; householdId: string; role: string; household: { residentName: string } }> } | null = null
  if (p.data.email) {
    user = await db.user.findUnique({
      where: { email: p.data.email },
      select: {
        id: true,
        name: true,
        memberships: {
          select: {
            id: true,
            householdId: true,
            role: true,
            household: { select: { residentName: true } },
          },
          where: { consent: 'approved' },
        },
      },
    })
  } else if (p.data.phone) {
    user = await db.user.findUnique({
      where: { phone: p.data.phone },
      select: {
        id: true,
        name: true,
        memberships: {
          select: {
            id: true,
            householdId: true,
            role: true,
            household: { select: { residentName: true } },
          },
          where: { consent: 'approved' },
        },
      },
    })
  }

  // Generic error – don't tell caller whether the address exists
  if (!user) return fail('Invalid code', 401)

  const codeHash = hashOtp(p.data.otp)
  const now      = new Date()

  // Find a valid, unused OTP for this user
  const otpRecord = await db.otpCode.findFirst({
    where: {
      userId:    user.id,
      codeHash,
      used:      false,
      expiresAt: { gt: now },
    },
  })

  if (!otpRecord) return fail('Invalid code', 401)

  // Mark as used immediately (single-use)
  await db.otpCode.update({
    where: { id: otpRecord.id },
    data:  { used: true },
  })

  // Issue a short-lived "pending" token (kind='pending', no householdId yet).
  // This token is only valid for the /api/auth/select-household route.
  const token = makeToken({
    kind:        'pending',
    sub:         user.id,
    householdId: '',          // empty string – pending tokens carry no household
    epoch:       1,
    exp:         Math.floor(Date.now() / 1000) + 60 * 15,  // 15 minutes to pick a household
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
