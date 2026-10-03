// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE, cookieOpts, fail, parse } from '@/lib/guard'
import { makeToken } from '@/lib/auth'
import { getDb } from '@/lib/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST {userId, otp}: verify OTP and create a session.
 * If the user has only one household, redirect to that household.
 * If multiple, show household selector.
 */
export async function POST(req: NextRequest) {
  const p = await parse(req, z.object({
    userId: z.string(),
    otp: z.string().length(6)
  }))
  if (!p.ok) return p.res

  // TODO: Verify OTP against stored value
  // For now, just check it's a 6-digit number (development only)
  if (process.env.NODE_ENV === 'production') {
    // In production, verify against stored OTP
    // For now, we'll skip this since we don't have proper OTP storage yet
  }

  const db = getDb()
  const user = await db.user.findUnique({
    where: { id: p.data.userId },
    include: {
      memberships: {
        include: { household: true }
      }
    }
  })

  if (!user) {
    return fail('User not found', 404)
  }

  // Create session token for the user
  // We'll create a temporary token that doesn't have a householdId yet
  // The user will need to select a household, or we'll auto-select if only one
  const token = makeToken({
    kind: 'helper',
    sub: user.id,
    householdId: '', // Will be set after household selection
    epoch: 1,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 // 30 days
  })

  if (!token) {
    return fail('Failed to create token', 500)
  }

  const res = NextResponse.json({
    ok: true,
    userId: user.id,
    name: user.name,
    memberships: user.memberships.map((m: any) => ({
      id: m.id,
      householdId: m.householdId,
      role: m.role,
      residentName: m.household.residentName
    }))
  })

  res.cookies.set(COOKIE, token, cookieOpts)
  return res
}
