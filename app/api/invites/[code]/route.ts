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
      include: { household: true },
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

  const res = NextResponse.json({
    ok: true,
    householdName: invite.household.residentName,
    role: invite.role,
  })
  res.headers.set('Cache-Control', 'no-store')
  return res
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

  // Handle decline - do not mutate the invite
  if (action === 'decline') {
    return NextResponse.json({ ok: true, declined: true })
  }

  // Handle accept - use transaction for atomicity
  // Per user decision: guardian approval required, so consent is 'pending'
  if (!['guardian', 'helper'].includes(invite.role)) {
    return fail('Invalid invite role', 400)
  }

  try {
    const result = await db.$transaction(async (tx) => {
      // Mark invite as accepted (if still pending and not expired)
      const updated = await tx.invite.updateMany({
        where: {
          id: invite.id,
          status: 'pending',
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        data: { status: 'accepted', acceptedByUserId: userId },
      })
      if (updated.count !== 1) {
        throw new Error('Invite already accepted or not pending')
      }

      // Create or update membership
      const memberCount = await tx.membership.count({ where: { householdId: invite.householdId } })
      const membership = await tx.membership.upsert({
        where: { userId_householdId: { userId, householdId: invite.householdId } },
        create: {
          userId,
          householdId: invite.householdId,
          role: invite.role,
          consent: 'pending', // Guardian approval required
          consentAt: new Date(),
          position: memberCount,
          emoji: '🙂',
          tokenEpoch: 1,
        },
        update: {
          consent: 'pending', // Reset to pending if declined
          role: invite.role,
        },
      })

      return { membership }
    })

    return NextResponse.json({
      ok: true,
      membershipId: result.membership.id,
      householdId: invite.householdId,
      role: invite.role,
    })
  } catch (e) {
    console.error('[INVITES POST] Failed to accept invite', e)
    return fail('This invite has already been accepted or is no longer valid.', 409)
  }
}

