import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyToken, makeToken } from '@/lib/auth'
import { COOKIE, DEVICE_COOKIE, cookieOpts, deviceCookieOpts, fail, getSession, authorizeResident, parse } from '@/lib/guard'
import { getDb } from '@/lib/db/client'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** GET: who am I? (used by the UI) */
export async function GET(req: NextRequest) {
  const s = await getSession(req)
  if (!s) return fail('Not signed in', 401)

  if (s.kind === 'helper') {
    const db = getDb()
    const membership = await db.membership.findUnique({
      where: { id: s.membershipId },
      include: { user: true, household: true }
    })
    if (!membership) return fail('Membership not found', 404)
    return NextResponse.json({
      kind: 'helper',
      userId: s.userId,
      householdId: s.householdId,
      membershipId: s.membershipId,
      role: s.role,
      name: membership.user.name,
      residentName: membership.household.residentName
    })
  }

  if (s.kind === 'resident') {
    const db = getDb()
    const household = await db.household.findUnique({
      where: { id: s.householdId }
    })
    if (!household) return fail('Household not found', 404)
    return NextResponse.json({
      kind: 'resident',
      userId: s.userId,
      householdId: s.householdId,
      residentName: household.residentName
    })
  }

  return fail('Unknown session type', 400)
}

/**
 * POST {pairingCode}: resident device pairing.
 * The resident enters a 6-digit code shown by the guardian.
 * Returns a device token cookie.
 */
export async function POST(req: NextRequest) {
  const p = await parse(req, z.object({ pairingCode: z.string().length(6) }))
  if (p.ok === false) return p.res

  const codeHash = crypto.createHash('sha256').update(p.data.pairingCode).digest('hex')

  const db = getDb()
  const device = await db.residentDevice.findUnique({
    where: { pairingCodeHash: codeHash },
    include: { household: true }
  })

  if (!device) {
    return fail('Invalid pairing code', 401)
  }

  // Update last seen
  await db.residentDevice.update({
    where: { id: device.id },
    data: { lastSeenAt: new Date() }
  })

  // Create device token
  const household = await db.household.findUnique({
    where: { id: device.householdId },
    select: { residentEpoch: true }
  })
  const epoch = household?.residentEpoch ?? 1

  const token = makeToken({
    kind: 'device',
    sub: device.id,
    householdId: device.householdId,
    epoch,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365 // 1 year
  })

  if (!token) {
    return fail('Failed to create token', 500)
  }

  const res = NextResponse.json({ ok: true, householdId: device.householdId })
  res.cookies.set(DEVICE_COOKIE, token, deviceCookieOpts)
  return res
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(COOKIE, '', { ...cookieOpts, maxAge: 0 })
  res.cookies.set(DEVICE_COOKIE, '', { ...deviceCookieOpts, maxAge: 0 })
  return res
}
