// @ts-nocheck
// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE, cookieOpts, fail, parse, getSession } from '@/lib/guard'
import { makeToken } from '@/lib/auth'
import { getDb } from '@/lib/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST {membershipId}: select a household and update the session token.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req)
  if (!session) {
    return fail('Not signed in', 401)
  }

  const p = await parse(req, z.object({ membershipId: z.string() }))
  if (!p.ok) return p.res

  const db = getDb()
  const membership = await db.membership.findUnique({
    where: { id: p.data.membershipId },
    include: { household: true }
  })

  if (!membership || membership.userId !== session.userId) {
    return fail('Invalid membership', 403)
  }

  // Create new token with householdId
  const token = makeToken({
    kind: 'helper',
    sub: session.userId,
    householdId: membership.householdId,
    epoch: membership.tokenEpoch,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 // 30 days
  })

  if (!token) {
    return fail('Failed to create token', 500)
  }

  const res = NextResponse.json({
    ok: true,
    householdId: membership.householdId,
    role: membership.role,
    residentName: membership.household.residentName
  })

  res.cookies.set(COOKIE, token, cookieOpts)
  return res
}
