// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createMembership, deleteMembership, updateMembership, moveMembership, setMembershipConsent, reorderMemberships, getMembershipsForHousehold } from '@/lib/db/memberships'
import { createInvite, getInvitesForHousehold, deleteInvite } from '@/lib/db/invites'
import { authorize, fail, parse } from '@/lib/guard'
import { getDb } from '@/lib/db/client'
import { makeToken } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (!a.ok) return a.res
  const householdId = a.session!.householdId
  const memberships = await getMembershipsForHousehold(householdId)
  const invites = await getInvitesForHousehold(householdId)
  return NextResponse.json({
    members: memberships.map((m: any) => ({
      id: m.id,
      name: m.user.name,
      phone: m.user.phone,
      email: m.user.email,
      emoji: m.emoji,
      consent: m.consent,
      role: m.role,
      position: m.position,
    })),
    invites: invites.map((i: any) => ({
      id: i.id,
      code: i.code,
      role: i.role,
      status: i.status,
      expiresAt: i.expiresAt,
      createdBy: i.createdBy.name,
    }))
  })
}

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('invite'), email: z.string().email().optional(), phone: z.string().trim().regex(/^\+\d{8,15}$/).optional(), name: z.string().trim().min(1).max(30), role: z.enum(['guardian', 'helper']), emoji: z.string().max(8).default('🙂') }),
  z.object({ action: z.literal('remove'), id: z.string().max(80) }),
  z.object({ action: z.literal('move'), id: z.string().max(80), dir: z.union([z.literal(-1), z.literal(1)]) }),
  z.object({ action: z.literal('consent'), id: z.string().max(80), consent: z.enum(['approved', 'declined', 'pending']) }),
  z.object({ action: z.literal('reorder'), ids: z.array(z.string().max(80)) }),
  z.object({ action: z.literal('revoke'), id: z.string().max(80) }),
  z.object({ action: z.literal('createInvite'), role: z.enum(['guardian', 'helper']) }),
  z.object({ action: z.literal('deleteInvite'), id: z.string().max(80) }),
])

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (!a.ok) return a.res
  const householdId = a.session!.householdId
  const p = await parse(req, Body)
  if (!p.ok) return p.res
  const b = p.data

  switch (b.action) {
    case 'invite': {
      if (!b.email && !b.phone) return fail('Email or phone required')
      
      // Find or create user
      let user
      if (b.email) {
        user = await getDb().user.upsert({
          where: { email: b.email },
          update: {},
          create: { email: b.email, name: b.name }
        })
      } else {
        user = await getDb().user.upsert({
          where: { phone: b.phone! },
          update: {},
          create: { phone: b.phone!, name: b.name }
        })
      }

      // Get current max position
      const currentMembers = await getMembershipsForHousehold(householdId)
      const maxPosition = currentMembers.length > 0 ? Math.max(...currentMembers.map((m: any) => m.position)) : -1

      const membership = await createMembership({
        userId: user.id,
        householdId,
        role: b.role,
        position: maxPosition + 1,
        emoji: b.emoji,
      })

      return NextResponse.json({ ok: true, membership: { id: membership.id, name: user.name, email: user.email, phone: user.phone } })
    }
    case 'remove':
      await deleteMembership(b.id)
      return NextResponse.json({ ok: true })
    case 'move':
      await moveMembership(b.id, b.dir)
      return NextResponse.json({ ok: true })
    case 'consent':
      await setMembershipConsent(b.id, b.consent)
      return NextResponse.json({ ok: true })
    case 'reorder':
      await reorderMemberships(householdId, b.ids)
      return NextResponse.json({ ok: true })
    case 'revoke': {
      await setMembershipConsent(b.id, 'pending')
      // Rotate epoch to invalidate all tokens
      await getDb().membership.update({
        where: { id: b.id },
        data: { tokenEpoch: { increment: 1 } }
      })
      return NextResponse.json({ ok: true })
    }
    case 'createInvite': {
      const db = getDb()
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
      const invite = await createInvite({
        householdId,
        role: b.role,
        createdByUserId: a.session!.userId,
        expiresAt,
      })
      return NextResponse.json({ ok: true, invite: { code: invite.code, role: invite.role, expiresAt: invite.expiresAt } })
    }
    case 'deleteInvite': {
      await deleteInvite(b.id)
      return NextResponse.json({ ok: true })
    }
  }
}
