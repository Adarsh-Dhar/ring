import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { setQuiet, setTimeoutSec, getSetup, setPlannedMode, PLANNED_MODES } from '@/lib/doorbell/store'
import { updateHousehold, createResidentDevice, createHousehold } from '@/lib/db/households'
import { authorize, fail, parse, getPendingUserId } from '@/lib/guard'
import { makeToken } from '@/lib/auth'
import { normalizePhone, normalizeEmail } from '@/lib/identity'
import { getDb } from '@/lib/db/client'
import { findActiveLink } from '@/lib/db/visit-requests'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const hour = z.number().int().min(0).max(23)

export async function GET(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res
  const householdId = a.session!.householdId

  let setup: Awaited<ReturnType<typeof getSetup>>
  try {
    setup = await getSetup(householdId)
  } catch (e) {
    console.error('[HOUSEHOLD GET] Failed to load household setup', e)
    return fail('Unable to load household settings. Please try again.', 503)
  }

  if (!setup) return fail('Household not found. It may have been deleted.', 404)

  let hh: any
  let link: any
  try {
    const { getHousehold } = await import('@/lib/db/households')
    hh   = await getHousehold(householdId)
    link = await findActiveLink(householdId)
  } catch (e) {
    console.error('[HOUSEHOLD GET] Failed to load household details or visit link', e)
    return fail('Unable to load household details. Please try again.', 503)
  }

  return NextResponse.json({
    ...setup,
    requireResidentOk: !!(hh as any)?.requireResidentOk,
    visitLink: link
      ? { active: true,  createdAt: link.createdAt.getTime() }
      : { active: false, createdAt: null },
  })
}

const Body = z.discriminatedUnion('action', [
  z.object({
    action:        z.literal('create'),
    residentName:  z.string().trim().min(1).max(60),
    guardianName:  z.string().trim().min(1).max(60),
    guardianPhone: z.string().trim().optional(),
    guardianEmail: z.string().email().optional(),
    timezone:      z.string().optional(),
  }),
  z.object({ action: z.literal('quiet'), enabled: z.boolean(), startHour: hour, endHour: hour }),
  z.object({ action: z.literal('timeout'), value: z.number().finite() }),
  z.object({ action: z.literal('createDevice') }),
  z.object({
    action:          z.literal('updateSettings'),
    residentName:  z.string().trim().min(1).max(30),
    timezone:        z.string().optional(),
    emergencyNumber: z.string().optional(),
  }),
  z.object({
    action: z.literal('plannedMode'),
    mode:   z.enum([...PLANNED_MODES] as [string, ...string[]]),
  }),
  z.object({ action: z.literal('requireResidentOk'), value: z.boolean() }),
])

export async function POST(req: NextRequest) {
  const p = await parse(req, Body)
  if (p.ok === false) return p.res
  const b = p.data

  // ── Household creation ─────────────────────────────────────────────────────
  if (b.action === 'create') {
    const pendingUserId = await getPendingUserId(req)
    let guardianUserId: string | null = pendingUserId

    if (!guardianUserId) {
      const a = await authorize(req, 'user')
      if (a.ok === false) return fail('You must be signed in to create a household.', 401)
      guardianUserId = a.session!.userId
    }

    if (!b.guardianPhone && !b.guardianEmail) {
      return fail('Guardian phone number or email address is required.', 400)
    }

    const guardianPhone = b.guardianPhone && b.guardianPhone.trim() ? normalizePhone(b.guardianPhone) : null
    const guardianEmail = b.guardianEmail && b.guardianEmail.trim() ? normalizeEmail(b.guardianEmail) : null

    if (b.guardianPhone && b.guardianPhone.trim() && !guardianPhone) {
      return fail(`"${b.guardianPhone}" is not a valid phone number. Use E.164 format, e.g. +919876543210`, 400)
    }

    let db
    try {
      db = getDb()
    } catch (e) {
      console.error('[HOUSEHOLD CREATE] Failed to get database connection', e)
      return fail('Database is unavailable. Please try again shortly.', 503)
    }

    // Load the current user to avoid unique-constraint errors when the
    // phone/email was already captured at OTP sign-in.
    let currentUser: { name: string | null; phone: string | null; email: string | null } | null = null
    try {
      currentUser = await db.user.findUnique({
        where:  { id: guardianUserId },
        select: { name: true, phone: true, email: true },
      })
    } catch (e) {
      console.error('[HOUSEHOLD CREATE] Failed to load current user', e)
      return fail('Unable to load your account. Please try again.', 503)
    }

    if (!currentUser) {
      return fail('Your account was not found. Please sign in again.', 401)
    }

    // Only write a field if it is not already set — prevents P2002 unique constraint
    // errors when the user already has this phone/email from OTP sign-in.
    const profileUpdate: Record<string, string> = {}
    if (b.guardianName && b.guardianName !== currentUser.name) {
      profileUpdate.name = b.guardianName
    }
    if (guardianPhone && guardianPhone !== currentUser.phone) {
      profileUpdate.phone = guardianPhone
    }
    if (guardianEmail && !guardianPhone && guardianEmail !== currentUser.email) {
      profileUpdate.email = guardianEmail
    }

    if (Object.keys(profileUpdate).length > 0) {
      try {
        await db.user.update({ where: { id: guardianUserId }, data: profileUpdate })
      } catch (e: any) {
        // P2002 = unique constraint — the phone/email belongs to another account
        if (e?.code === 'P2002') {
          const field = (e?.meta?.target as string[] | undefined)?.join(', ') ?? 'phone or email'
          const conflictingValue = profileUpdate[field as 'phone' | 'email']
          
          // Check if the conflicting account has a household
          const conflictingUser = await db.user.findUnique({
            where: { [field as 'phone' | 'email']: conflictingValue },
            select: {
              id: true,
              memberships: {
                where: { consent: 'approved' },
                select: { householdId: true }
              }
            }
          })

          if (conflictingUser && conflictingUser.memberships.length > 0) {
            // The other account has a household - tell them to sign in with that account
            return fail(
              `That ${field} is already registered to another account with a household. Please sign in using that ${field} instead.`,
              409
            )
          }

          // The other account has no household - transfer the phone/email to current account
          if (conflictingUser) {
            try {
              // Clear the field from the old account
              await db.user.update({
                where: { id: conflictingUser.id },
                data: { [field as 'phone' | 'email']: null }
              })
              // Now set it on the current account
              await db.user.update({
                where: { id: guardianUserId },
                data: profileUpdate
              })
            } catch (mergeError) {
              console.error('[HOUSEHOLD CREATE] Failed to transfer phone/email between accounts', mergeError)
              return fail('Unable to update your profile. Please try again.', 503)
            }
          } else {
            return fail(`That ${field} is already registered to another account.`, 409)
          }
        }
        console.error('[HOUSEHOLD CREATE] Failed to update user profile', e)
        return fail('Unable to update your profile. Please try again.', 503)
      }
    }

    let existingGuardian: any
    try {
      existingGuardian = await db.membership.findFirst({
        where: { userId: guardianUserId, role: 'guardian' },
      })
    } catch (e) {
      console.error('[HOUSEHOLD CREATE] Failed to check existing guardianship', e)
      return fail('Unable to check existing households. Please try again.', 503)
    }

    if (existingGuardian) {
      return fail('You are already a guardian of a household. Each account can only manage one household.', 400)
    }

    let household: Awaited<ReturnType<typeof createHousehold>>
    try {
      household = await createHousehold({
        residentName: b.residentName,
        timezone:     b.timezone,
      })
    } catch (e) {
      console.error('[HOUSEHOLD CREATE] Failed to create household', e)
      return fail('Unable to create household. Please try again.', 503)
    }

    let membership: any
    try {
      const memberCount = await db.membership.count({ where: { householdId: household.id } })
      membership = await db.membership.create({
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
    } catch (e) {
      console.error('[HOUSEHOLD CREATE] Failed to create guardian membership', e)
      return fail('Household was created but failed to assign your guardian role. Please contact support.', 503)
    }

    // Don't change the session - keep the user's existing 'user' session
    // The user now has a household and can access it via their user session

    return NextResponse.json({
      ok:          true,
      householdId: household.id,
      role:        'guardian',
      residentName: household.residentName,
    })
  }

  // ── All other actions require a guardian session ───────────────────────────
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res
  const householdId = a.session!.householdId

  try {
    switch (b.action) {
      case 'quiet':
        await setQuiet(householdId, { enabled: b.enabled, startHour: b.startHour, endHour: b.endHour })
        return NextResponse.json({ ok: true })

      case 'timeout':
        if (b.value < 10 || b.value > 600) {
          return fail('Timeout must be between 10 and 600 seconds.', 400)
        }
        await setTimeoutSec(householdId, b.value)
        return NextResponse.json({ ok: true })

      case 'createDevice': {
        // Generate a 6-character uppercase alphanumeric code (no ambiguous chars like 0/O, 1/I).
        // Uses crypto.randomInt for uniform distribution across the alphabet.
        const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'  // 32 chars — no 0/O/1/I
        const code = Array.from({ length: 6 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('')
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

      case 'plannedMode':
        await setPlannedMode(householdId, b.mode as any)
        return NextResponse.json({ ok: true })

      case 'requireResidentOk':
        await updateHousehold(householdId, { requireResidentOk: b.value })
        return NextResponse.json({ ok: true })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[HOUSEHOLD POST action=${b.action}]`, e)
    return fail(`Failed to update household settings: ${msg}`, 503)
  }
}
