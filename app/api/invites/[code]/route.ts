// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { fail, parse, getSession, authorize } from '@/lib/guard'
import { getDb } from '@/lib/db/client'
import { makeToken } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/invites/[code]: Validate an invite code and return household info
 */
export async function GET(req: NextRequest, context: { params: Promise<{ code: string }> }) {
  const params = await context.params
  const db = getDb()
  const invite = await db.invite.findUnique({
    where: { code: params.code },
    include: { household: true, createdBy: { include: { user: true } } }
  })

  if (!invite) {
    return fail('Invalid invite code', 404)
  }

  if (invite.status !== 'pending') {
    return fail('Invite has already been used', 400)
  }

  if (invite.expiresAt && new Date() > invite.expiresAt) {
    return fail('Invite has expired', 400)
  }

  return NextResponse.json({
    ok: true,
    household: {
      id: invite.householdId,
      residentName: invite.household.residentName,
    },
    createdBy: invite.createdBy.name,
  })
}

/**
 * POST /api/invites/[code]: Accept an invite (requires login)
 */
export async function POST(req: NextRequest, context: { params: Promise<{ code: string }> }) {
  const params = await context.params
  const session = await getSession(req)
  if (!session) {
    return fail('Not signed in', 401)
  }

  const db = getDb()
  const invite = await db.invite.findUnique({
    where: { code: params.code },
    include: { household: true }
  })

  if (!invite) {
    return fail('Invalid invite code', 404)
  }

  if (invite.status !== 'pending') {
    return fail('Invite has already been used', 400)
  }

  if (invite.expiresAt && new Date() > invite.expiresAt) {
    return fail('Invite has expired', 400)
  }

  // Check if user is already a member
  const existingMembership = await db.membership.findUnique({
    where: {
      userId_householdId: {
        userId: session.userId,
        householdId: invite.householdId
      }
    }
  })

  if (existingMembership) {
    return fail('You are already a member of this household', 400)
  }

  // Create membership
  const maxPosition = await db.membership.count({
    where: { householdId: invite.householdId }
  })

  const membership = await db.membership.create({
    data: {
      userId: session.userId,
      householdId: invite.householdId,
      role: invite.role,
      consent: 'pending',
      position: maxPosition,
      emoji: '🙂',
    }
  })

  // Mark invite as accepted
  await db.invite.update({
    where: { id: invite.id },
    data: { status: 'accepted', acceptedByUserId: session.userId }
  })

  // Create session token for this household
  const token = makeToken({
    kind: 'helper',
    sub: session.userId,
    householdId: invite.householdId,
    epoch: membership.tokenEpoch,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 // 30 days
  })

  if (!token) {
    return fail('Failed to create session', 500)
  }

  const res = NextResponse.json({
    ok: true,
    membershipId: membership.id,
    householdId: invite.householdId,
    role: invite.role,
  })

  res.cookies.set('db_session', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 30 })
  return res
}
