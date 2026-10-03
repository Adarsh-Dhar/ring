import { NextRequest, NextResponse } from 'next/server'
import { fail, getAnyUserId, cookieOpts, COOKIE } from '@/lib/guard'
import { getDb } from '@/lib/db/client'
import { makeToken } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/invites/[code]
 * Validate an invite code and return household info (no auth required).
 */
export async function GET(req: NextRequest, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params
  const db     = getDb()
  const invite = await db.invite.findUnique({
    where:   { code },
    include: { household: true, createdBy: true },
  })

  if (!invite)                                    return fail('Invalid invite code', 404)
  if (invite.status !== 'pending')                return fail('Invite has already been used', 400)
  if (invite.expiresAt && new Date() > invite.expiresAt) return fail('Invite has expired', 400)

  return NextResponse.json({
    ok: true,
    household: {
      id:           invite.householdId,
      residentName: invite.household.residentName,
    },
    createdBy: invite.createdBy.name,
  })
}

/**
 * POST /api/invites/[code]
 * Accept an invite.  Requires the caller to already have a valid session
 * (pending or full – any authenticated user can accept an invite).
 * Issues a new full-session token scoped to the new membership.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ code: string }> }) {
  const { code }  = await context.params
  const userId    = await getAnyUserId(req)
  if (!userId) return fail('Not signed in', 401)

  const db     = getDb()
  const invite = await db.invite.findUnique({
    where:   { code },
    include: { household: true },
  })

  if (!invite)                                    return fail('Invalid invite code', 404)
  if (invite.status !== 'pending')                return fail('Invite has already been used', 400)
  if (invite.expiresAt && new Date() > invite.expiresAt) return fail('Invite has expired', 400)

  // Reject if the user is already in this household
  const existing = await db.membership.findUnique({
    where: { userId_householdId: { userId, householdId: invite.householdId } },
  })
  if (existing) return fail('You are already a member of this household', 400)

  const memberCount = await db.membership.count({ where: { householdId: invite.householdId } })

  const membership = await db.membership.create({
    data: {
      userId,
      householdId: invite.householdId,
      role:        invite.role,
      consent:     'pending',
      position:    memberCount,
      emoji:       '🙂',
      tokenEpoch:  1,
    },
  })

  await db.invite.update({
    where: { id: invite.id },
    data:  { status: 'accepted', acceptedByUserId: userId },
  })

  // Issue a full session token scoped to the new membership
  const token = makeToken({
    kind:        'helper',
    sub:         membership.id,          // membershipId, not userId
    householdId: invite.householdId,
    epoch:       membership.tokenEpoch,
    exp:         Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
  })
  if (!token) return fail('Failed to create session', 500)

  const res = NextResponse.json({
    ok:          true,
    membershipId: membership.id,
    householdId:  invite.householdId,
    role:         invite.role,
  })
  res.cookies.set(COOKIE, token, cookieOpts)
  return res
}
