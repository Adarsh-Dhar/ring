import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  createMembership,
  deleteMembership,
  updateMembership,
  moveMembership,
  setMembershipConsent,
  reorderMemberships,
  getMembershipsForHousehold,
} from '@/lib/db/memberships'
import { createInvite, getInvitesForHousehold, deleteInvite } from '@/lib/db/invites'
import { authorize, fail, parse } from '@/lib/guard'
import { getDb } from '@/lib/db/client'
import { normalizeEmail } from '@/lib/identity'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const a = await authorize(req, 'guardian', 'helper')
  if (a.ok === false) return a.res

  const householdId = a.session!.householdId

  let memberships: Awaited<ReturnType<typeof getMembershipsForHousehold>>
  let invites: Awaited<ReturnType<typeof getInvitesForHousehold>>
  try {
    memberships = await getMembershipsForHousehold(householdId)
    invites     = await getInvitesForHousehold(householdId)
  } catch (e) {
    console.error('[MEMBERS GET] Failed to load members or invites', e)
    return fail('Unable to load household members. Please try again.', 503)
  }

  return NextResponse.json({
    members: memberships.map(m => ({
      id:       m.id,
      name:     m.user.name,
      phone:    m.user.phone,
      email:    m.user.email,
      emoji:    m.emoji,
      consent:  m.consent,
      role:     m.role,
      position: m.position,
    })),
    invites: invites.map(i => ({
      id:        i.id,
      code:      i.code,
      role:      i.role,
      status:    i.status,
      expiresAt: i.expiresAt,
      createdBy: i.createdBy?.name ?? null,
    })),
  })
}

const Body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('invite'),
    email:  z.string().email(),
    name:   z.string().trim().min(1).max(60),
    role:   z.enum(['guardian', 'helper']),
    emoji:  z.string().max(8).default('🙂'),
  }),
  z.object({ action: z.literal('remove'),  id: z.string().max(80) }),
  z.object({ action: z.literal('move'),    id: z.string().max(80), dir: z.union([z.literal(-1), z.literal(1)]) }),
  z.object({ action: z.literal('consent'), id: z.string().max(80), consent: z.enum(['pending', 'declined']) }),
  z.object({ action: z.literal('reorder'), ids: z.array(z.string().max(80)) }),
  z.object({ action: z.literal('revoke'),  id: z.string().max(80) }),
  z.object({ action: z.literal('createInvite'), role: z.enum(['guardian', 'helper']) }),
  z.object({ action: z.literal('deleteInvite'), id: z.string().max(80) }),
])

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res

  const householdId = a.session!.householdId

  const p = await parse(req, Body)
  if (p.ok === false) return p.res
  const b = p.data

  let db
  try {
    db = getDb()
  } catch (e) {
    console.error('[MEMBERS POST] Failed to get database connection', e)
    return fail('Database is unavailable. Please try again shortly.', 503)
  }

  try {
    switch (b.action) {
      case 'invite': {
        if (!b.email) {
          return fail('An email address is required to invite a member.', 400)
        }

        // Prevent inviting yourself
        if (b.email.toLowerCase() === a.session!.userId) {
          return fail('You cannot invite yourself.', 400)
        }

        const email = normalizeEmail(b.email)

        // Check if user exists
        let user = await db.user.findUnique({ where: { email } })
        if (!user) {
          // Create new user without password (Google-only auth)
          user = await db.user.create({
            data: { email, name: b.name },
          })
        }

        // Check if they're already a member
        const existing = await db.membership.findFirst({
          where: { userId: user.id, householdId },
        })
        if (existing) {
          // Block role change on existing member
          if (existing.role !== b.role) {
            return fail(`${b.name} is already a member with a different role.`, 409)
          }
          return fail(`${b.name} is already a member of this household.`, 409)
        }

        const currentMembers = await getMembershipsForHousehold(householdId)
        const maxPosition    = currentMembers.length > 0
          ? Math.max(...currentMembers.map(m => m.position))
          : -1

        // Get household and sender name for notification
        const household = await db.household.findUnique({
          where: { id: householdId },
          select: { residentName: true },
        })

        const sender = await db.user.findUnique({
          where: { id: a.session!.userId },
          select: { name: true },
        })

        const membership = await createMembership({
          userId: user.id,
          householdId,
          role:     b.role,
          position: maxPosition + 1,
          emoji:    b.emoji,
        })

        // Create notification for the member with proper metadata
        await db.notification.create({
          data: {
            type: 'helper_invite',
            title: `You have been invited to join as a ${b.role}`,
            message: `${sender?.name || 'Someone'} has invited you to join as a ${b.role} in ${household?.residentName || 'a household'}.`,
            toUserId: user.id,
            fromUserId: a.session!.userId,
            status: 'pending',
            metadata: {
              membershipId: membership.id,
              householdId,
              role: b.role,
            },
          },
        })

        return NextResponse.json({
          ok: true,
          membership: { id: membership.id, name: user.name, email: user.email, phone: user.phone },
        })
      }

      case 'remove': {
        const membership = await db.membership.findUnique({ where: { id: b.id } })
        if (!membership) return fail('Member not found. They may have already been removed.', 404)
        if (membership.householdId !== householdId) return fail('This member does not belong to your household.', 403)
        await deleteMembership(b.id)
        return NextResponse.json({ ok: true })
      }

      case 'move': {
        const membership = await db.membership.findUnique({ where: { id: b.id } })
        if (!membership) return fail('Member not found.', 404)
        if (membership.householdId !== householdId) return fail('This member does not belong to your household.', 403)
        await moveMembership(b.id, b.dir)
        return NextResponse.json({ ok: true })
      }

      case 'consent': {
        const membership = await db.membership.findUnique({ where: { id: b.id } })
        if (!membership) return fail('Member not found.', 404)
        if (membership.householdId !== householdId) return fail('This member does not belong to your household.', 403)
        await setMembershipConsent(b.id, b.consent)
        return NextResponse.json({ ok: true })
      }

      case 'reorder': {
        if (b.ids.length === 0) return fail('No member IDs provided for reordering.', 400)
        await reorderMemberships(householdId, b.ids)
        return NextResponse.json({ ok: true })
      }

      case 'revoke': {
        const membership = await db.membership.findUnique({ where: { id: b.id } })
        if (!membership) return fail('Member not found.', 404)
        if (membership.householdId !== householdId) return fail('This member does not belong to your household.', 403)
        await setMembershipConsent(b.id, 'pending')
        await db.membership.update({
          where: { id: b.id },
          data:  { tokenEpoch: { increment: 1 } },
        })
        return NextResponse.json({ ok: true })
      }

      case 'createInvite': {
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        const invite    = await createInvite({
          householdId,
          role:            b.role,
          createdByUserId: a.session!.userId,
          expiresAt,
        })
        return NextResponse.json({
          ok:     true,
          invite: { code: invite.code, role: invite.role, expiresAt: invite.expiresAt },
        })
      }

      case 'deleteInvite': {
        const invite = await db.invite.findUnique({ where: { id: b.id } })
        if (!invite) return fail('Invite not found. It may have already been deleted.', 404)
        if (invite.householdId !== householdId) return fail('This invite does not belong to your household.', 403)
        await deleteInvite(b.id)
        return NextResponse.json({ ok: true })
      }
    }
  } catch (e) {
    console.error(`[MEMBERS POST action=${b.action}]`, e)
    return fail('Something went wrong. Please try again.', 500)
  }
}
