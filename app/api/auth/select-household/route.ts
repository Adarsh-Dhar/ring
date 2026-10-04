import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE, cookieOpts, fail, parse } from '@/lib/guard'
import { makeToken, verifyToken } from '@/lib/auth'
import { getDb } from '@/lib/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const rawToken = req.cookies.get(COOKIE)?.value ?? null
  const verified = verifyToken(rawToken)

  if (!verified.ok) {
    return fail('You are not signed in. Please sign in again.', 401)
  }
  if (verified.data.kind !== 'pending') {
    return fail('Invalid session type. Please sign in again.', 401)
  }

  const userId = verified.data.sub

  const p = await parse(req, z.object({ membershipId: z.string().min(1) }))
  if (p.ok === false) return p.res

  let db
  try {
    db = getDb()
  } catch (e) {
    console.error('[SELECT-HOUSEHOLD] Failed to get database connection', e)
    return fail('Database is unavailable. Please try again shortly.', 503)
  }

  let membership: {
    id: string
    userId: string
    consent: string
    householdId: string
    role: string
    tokenEpoch: number
    household: { residentName: string }
  } | null = null

  try {
    membership = await db.membership.findUnique({
      where:   { id: p.data.membershipId },
      include: { household: true },
    })
  } catch (e) {
    console.error('[SELECT-HOUSEHOLD] Failed to look up membership', e)
    return fail('Unable to load household details. Please try again.', 503)
  }

  if (!membership) {
    return fail('Household membership not found. It may have been removed.', 404)
  }
  if (membership.userId !== userId) {
    return fail('This household does not belong to your account.', 403)
  }
  if (membership.consent !== 'approved') {
    return fail(
      membership.consent === 'declined'
        ? 'Your access to this household has been declined.'
        : 'Your membership is pending approval from the household guardian.',
      403
    )
  }

  const token = makeToken({
    kind:        'helper',
    sub:         membership.id,
    householdId: membership.householdId,
    epoch:       membership.tokenEpoch,
    exp:         Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
  })

  if (!token) {
    return fail('Failed to create session token. Check that AUTH_SECRET is set.', 500)
  }

  const res = NextResponse.json({
    ok:          true,
    householdId: membership.householdId,
    role:        membership.role,
    residentName: membership.household.residentName,
  })

  res.cookies.set(COOKIE, token, cookieOpts)
  return res
}
