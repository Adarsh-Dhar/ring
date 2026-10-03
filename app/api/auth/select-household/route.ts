import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE, cookieOpts, fail, parse } from '@/lib/guard'
import { makeToken, verifyToken } from '@/lib/auth'
import { getDb } from '@/lib/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST { membershipId }
 *
 * Exchanges a pending session token (kind='pending', sub=userId) for a full
 * session token (kind='helper', sub=membershipId, householdId=<id>).
 *
 * The pending token is validated here – this route does NOT use guard.ts
 * authorize() because that only accepts fully-scoped helper/resident tokens.
 */
export async function POST(req: NextRequest) {
  // Read the pending token directly from the cookie
  const rawToken = req.cookies.get(COOKIE)?.value ?? null
  const verified = verifyToken(rawToken)

  if (!verified.ok || verified.data.kind !== 'pending') {
    return fail('Not signed in', 401)
  }

  const userId = verified.data.sub

  const p = await parse(req, z.object({ membershipId: z.string().min(1) }))
  if (p.ok === false) return p.res

  const db = getDb()
  const membership = await db.membership.findUnique({
    where:   { id: p.data.membershipId },
    include: { household: true },
  })

  // Verify the membership belongs to the authenticated user and is approved
  if (!membership || membership.userId !== userId) {
    return fail('Invalid membership', 403)
  }
  if (membership.consent !== 'approved') {
    return fail('Membership not yet approved', 403)
  }

  // Issue the full session token.
  // sub = membershipId  ← guard.ts helper branch uses getMembershipEpoch(sub)
  const token = makeToken({
    kind:        'helper',
    sub:         membership.id,          // membership ID, not user ID
    householdId: membership.householdId,
    epoch:       membership.tokenEpoch,
    exp:         Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,  // 30 days
  })

  if (!token) return fail('Failed to create session', 500)

  const res = NextResponse.json({
    ok:          true,
    householdId: membership.householdId,
    role:        membership.role,
    residentName: membership.household.residentName,
  })

  res.cookies.set(COOKIE, token, cookieOpts)
  return res
}
