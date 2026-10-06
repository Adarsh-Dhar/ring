import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { fail, getUserId, parse } from '@/lib/guard'
import { getDb } from '@/lib/db/client'
import { hit } from '@/lib/ratelimit'
import { clientIp } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ code: string }> }

/**
 * GET /api/invites/[code]
 * Validate an invite code and return household info (no auth required).
 */
export async function GET(req: NextRequest, context: Ctx) {
  const { code } = await context.params

  // Rate limit invite lookups
  const ip = clientIp(req)
  if (!hit(`invite:lookup:${ip}`, 10, 60_000)) {
    return fail('Too many invite lookups. Please wait a minute.', 429)
  }

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
    householdName: invite.household.residentName,
    role: invite.role,
    inviterName: invite.createdBy.name,
  })
}

const Body = z.object({
  action: z.enum(['accept', 'decline']).default('accept'),
})

/**
 * POST /api/invites/[code]
 * Accept or decline an invite. Requires the caller to already have a valid session
 * (pending or full). Issues a new full-session token scoped to the new membership.
 */
export async function POST(req: NextRequest, context: Ctx) {
  const { code } = await context.params

  if (!code || code.length < 6) {
    return fail('Invalid invite link — the code is missing or malformed.', 400)
  }

  const p = await parse(req, Body)
  if (p.ok === false) return p.res
  const { action } = p.data

  let userId: string | null
  try {
    userId = await getUserId(req)
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

  // Handle decline
  if (action === 'decline') {
    try {
      await db.invite.update({
        where: { id: invite.id },
        data:  { status: 'declined' },
      })
    } catch (e) {
      console.error('[INVITES POST] Failed to mark invite as declined', e)
      return fail('Unable to decline invite. Please try again.', 503)
    }
    return NextResponse.json({ ok: true, declined: true })
  }

  // Handle accept
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
    // If membership was declined, allow re-joining
    if (existing.consent === 'declined') {
      try {
        await db.membership.update({
          where: { id: existing.id },
          data: { consent: 'pending' },
        })
      } catch (e) {
        console.error('[INVITES POST] Failed to reset declined membership', e)
        return fail('Unable to reset your declined membership. Please try again.', 503)
      }
    } else {
      return fail('You are already a member of this household.', 409)
    }
  }

  let membership: any
  if (!existing) {
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
  } else {
    membership = existing
  }

  // Use transaction to mark invite as accepted with conditional update
  try {
    const result = await db.$transaction(async (tx) => {
      const updated = await tx.invite.updateMany({
        where: {
          id: invite.id,
          status: 'pending',
        },
        data: { status: 'accepted', acceptedByUserId: userId },
      })
      if (updated.count === 0) {
        throw new Error('Invite already accepted or not pending')
      }
      return updated
    })
  } catch (e) {
    console.error('[INVITES POST] Failed to mark invite as accepted', e)
    // Rollback membership creation if invite was already accepted
    if (!existing) {
      try {
        await db.membership.delete({ where: { id: membership.id } })
      } catch (deleteError) {
        console.error('[INVITES POST] Failed to rollback membership', deleteError)
      }
    }
    return fail('This invite has already been accepted or is no longer valid.', 409)
  }

  // Do not set a new cookie - the user is already signed in
  // Their role will be resolved from the DB on the next request
  return NextResponse.json({
    ok:          true,
    membershipId: membership.id,
    householdId:  invite.householdId,
    role:         invite.role,
  })
}
