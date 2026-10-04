import { NextRequest, NextResponse } from 'next/server'
import { fail, getAnyUserId, cookieOpts, COOKIE } from '@/lib/guard'
import { getDb } from '@/lib/db/client'
import { makeToken } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ code: string }> }

/**
 * GET /api/invites/[code]
 * Validate an invite code and return household info (no auth required).
 */
export async function GET(req: NextRequest, context: Ctx) {
  const { code } = await context.params

  if (!code || code.length < 6) {
    return fail('Invalid invite link — the code is missing or malformed.', 400)
  }

  let db
  try {
    db = getDb()
  } catch (e) {
    console.error('[INVITES GET] Failed to get database connection', e)
    return fail('Database is unavailable. Please try again shortly.', 503)
  }

  let invite: any
  try {
    invite = await db.invite.findUnique({
      where:   { code },
      include: { household: true, createdBy: true },
    })
  } catch (e) {
    console.error('[INVITES GET] Failed to look up invite', e)
    return fail('Unable to verify invite code. Please try again.', 503)
  }

  if (!invite) {
    return fail('This invite link is invalid or does not exist.', 404)
  }
  if (invite.status !== 'pending') {
    return fail(
      invite.status === 'accepted'
        ? 'This invite has already been accepted.'
        : 'This invite is no longer valid.',
      400
    )
  }
  if (invite.expiresAt && new Date() > invite.expiresAt) {
    return fail('This invite link has expired. Please ask the guardian to send a new one.', 400)
  }

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
 * Accept an invite. Requires the caller to already have a valid session
 * (pending or full). Issues a new full-session token scoped to the new membership.
 */
export async function POST(req: NextRequest, context: Ctx) {
  const { code } = await context.params

  if (!code || code.length < 6) {
    return fail('Invalid invite link — the code is missing or malformed.', 400)
  }

  let userId: string | null
  try {
    userId = await getAnyUserId(req)
  } catch (e) {
    console.error('[INVITES POST] Failed to resolve user session', e)
    return fail('Unable to verify your session. Please sign in again.', 503)
  }
  if (!userId) {
    return fail('You must be signed in to accept an invite.', 401)
  }

  let db
  try {
    db = getDb()
  } catch (e) {
    console.error('[INVITES POST] Failed to get database connection', e)
    return fail('Database is unavailable. Please try again shortly.', 503)
  }

  let invite: any
  try {
    invite = await db.invite.findUnique({
      where:   { code },
      include: { household: true },
    })
  } catch (e) {
    console.error('[INVITES POST] Failed to look up invite', e)
    return fail('Unable to verify invite code. Please try again.', 503)
  }

  if (!invite) {
    return fail('This invite link is invalid or does not exist.', 404)
  }
  if (invite.status !== 'pending') {
    return fail(
      invite.status === 'accepted'
        ? 'This invite has already been accepted.'
        : 'This invite is no longer valid.',
      400
    )
  }
  if (invite.expiresAt && new Date() > invite.expiresAt) {
    return fail('This invite link has expired. Please ask the guardian to send a new one.', 400)
  }

  let existing: any
  try {
    existing = await db.membership.findUnique({
      where: { userId_householdId: { userId, householdId: invite.householdId } },
    })
  } catch (e) {
    console.error('[INVITES POST] Failed to check existing membership', e)
    return fail('Unable to check your household membership. Please try again.', 503)
  }
  if (existing) {
    return fail('You are already a member of this household.', 409)
  }

  let membership: any
  try {
    const memberCount = await db.membership.count({ where: { householdId: invite.householdId } })
    membership = await db.membership.create({
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
  } catch (e) {
    console.error('[INVITES POST] Failed to create membership', e)
    return fail('Unable to create your household membership. Please try again.', 503)
  }

  try {
    await db.invite.update({
      where: { id: invite.id },
      data:  { status: 'accepted', acceptedByUserId: userId },
    })
  } catch (e) {
    // Non-fatal — membership was created, just couldn't mark invite as accepted
    console.error('[INVITES POST] Failed to mark invite as accepted', e)
  }

  const token = makeToken({
    kind:        'helper',
    sub:         membership.id,
    householdId: invite.householdId,
    epoch:       membership.tokenEpoch,
    exp:         Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
  })
  if (!token) {
    return fail('Invite accepted but failed to create session token. Check that AUTH_SECRET is set.', 500)
  }

  const res = NextResponse.json({
    ok:          true,
    membershipId: membership.id,
    householdId:  invite.householdId,
    role:         invite.role,
  })
  res.cookies.set(COOKIE, token, cookieOpts)
  return res
}
