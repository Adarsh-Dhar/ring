import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { setQuiet, setTimeoutSec, getSetup } from '@/lib/doorbell/store'
import { updateHousehold, createResidentDevice, createHousehold } from '@/lib/db/households'
import { authorize, fail, parse, COOKIE, cookieOpts, getPendingUserId } from '@/lib/guard'
import { makeToken } from '@/lib/auth'
import { getDb } from '@/lib/db/client'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const hour = z.number().int().min(0).max(23)

export async function GET(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res
  const householdId = a.session!.householdId
  return NextResponse.json(await getSetup(householdId))
}

const Body = z.discriminatedUnion('action', [
  // ── Onboarding: create the first household (pending token) ────────────────
  z.object({
    action:       z.literal('create'),
    residentName: z.string().trim().min(1).max(60),
    guardianName: z.string().trim().min(1).max(60),
    guardianPhone: z.string().trim().regex(/^\+\d{7,15}$/).optional(),
    guardianEmail: z.string().email().optional(),
    timezone:     z.string().optional(),
  }),
  // ── Existing-household settings (guardian session) ────────────────────────
  z.object({ action: z.literal('quiet'), enabled: z.boolean(), startHour: hour, endHour: hour }),
  z.object({ action: z.literal('timeout'), value: z.number().finite() }),
  z.object({ action: z.literal('createDevice') }),
  z.object({
    action:        z.literal('updateSettings'),
    residentName:  z.string().trim().min(1).max(30),
    timezone:      z.string().optional(),
    emergencyNumber: z.string().optional(),
  }),
])

export async function POST(req: NextRequest) {
  const p = await parse(req, Body)
  if (p.ok === false) return p.res
  const b = p.data

  // ── Household creation — the only action that accepts a pending token ──────
  if (b.action === 'create') {
    // Accept either a pending token (new user / first login) or a full
    // guardian session (guardian adding a second household — future use).
    const pendingUserId = await getPendingUserId(req)
    let guardianUserId: string | null = pendingUserId

    if (!guardianUserId) {
      // Maybe they already have a full session (e.g. adding a second household)
      const a = await authorize(req, 'guardian')
      if (a.ok === false) return fail('Not signed in', 401)
      guardianUserId = a.session!.userId
    }

    if (!b.guardianPhone && !b.guardianEmail) {
      return fail('Guardian phone or email is required', 400)
    }

    const db = getDb()

    // Update the user's name if they just provided it
    if (b.guardianName) {
      await db.user.update({
        where: { id: guardianUserId },
        data:  { name: b.guardianName },
      })
    }

    // Make sure this user doesn't already have a household as guardian
    const existingGuardian = await db.membership.findFirst({
      where: { userId: guardianUserId, role: 'guardian' },
    })
    if (existingGuardian) {
      return fail('You are already a guardian of a household', 400)
    }

    const household = await createHousehold({
      residentName: b.residentName,
      timezone:     b.timezone,
    })

    // Get current member count (should be 0, but be safe)
    const memberCount = await db.membership.count({ where: { householdId: household.id } })

    const membership = await db.membership.create({
      data: {
        userId:      guardianUserId,
        householdId: household.id,
        role:        'guardian',
        consent:     'approved',
        consentAt:   new Date(),
        position:    memberCount,
        tokenEpoch:  1,
        emoji:       '👤',
      },
    })

    // Issue a full guardian session token
    const token = makeToken({
      kind:        'helper',
      sub:         membership.id,
      householdId: household.id,
      epoch:       membership.tokenEpoch,
      exp:         Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
    })
    if (!token) return fail('Failed to create session', 500)

    const res = NextResponse.json({
      ok:          true,
      householdId: household.id,
      role:        'guardian',
      residentName: household.residentName,
    })
    res.cookies.set(COOKIE, token, cookieOpts)
    return res
  }

  // ── All other actions require a guardian session ───────────────────────────
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res
  const householdId = a.session!.householdId

  switch (b.action) {
    case 'quiet':
      await setQuiet(householdId, { enabled: b.enabled, startHour: b.startHour, endHour: b.endHour })
      return NextResponse.json({ ok: true })
    case 'timeout':
      await setTimeoutSec(householdId, b.value)
      return NextResponse.json({ ok: true })
    case 'createDevice': {
      const code   = crypto.randomBytes(3).toString('base64url').toUpperCase().slice(0, 6)
      const device = await createResidentDevice(householdId, code)
      return NextResponse.json({ ok: true, code, deviceId: device.id })
    }
    case 'updateSettings':
      await updateHousehold(householdId, {
        residentName:    b.residentName,
        timezone:        b.timezone,
        emergencyNumber: b.emergencyNumber,
      })
      return NextResponse.json({ ok: true })
  }
}
