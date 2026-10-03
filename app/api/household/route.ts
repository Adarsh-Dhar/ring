// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { setQuiet, setTimeoutSec, getSetup } from '@/lib/doorbell/store'
import { updateHousehold, createResidentDevice } from '@/lib/db/households'
import { authorize, fail, parse } from '@/lib/guard'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const hour = z.number().int().min(0).max(23)

export async function GET(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (!a.ok) return a.res
  const householdId = a.session!.householdId
  return NextResponse.json(await getSetup(householdId))
}

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('quiet'), enabled: z.boolean(), startHour: hour, endHour: hour }),
  z.object({ action: z.literal('timeout'), value: z.number().finite() }),
  z.object({ action: z.literal('createDevice') }),
  z.object({ action: z.literal('updateSettings'), residentName: z.string().trim().min(1).max(30), timezone: z.string().optional(), emergencyNumber: z.string().optional() }),
])

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (!a.ok) return a.res
  const householdId = a.session!.householdId
  const p = await parse(req, Body)
  if (!p.ok) return p.res
  const b = p.data

  switch (b.action) {
    case 'quiet':
      await setQuiet(householdId, { enabled: b.enabled, startHour: b.startHour, endHour: b.endHour })
      return NextResponse.json({ ok: true })
    case 'timeout':
      await setTimeoutSec(householdId, b.value)
      return NextResponse.json({ ok: true })
    case 'createDevice': {
      // Generate a 6-character pairing code
      const code = crypto.randomBytes(3).toString('base64url').toUpperCase().slice(0, 6)
      const device = await createResidentDevice(householdId, code)
      return NextResponse.json({ ok: true, code, deviceId: device.id })
    }
    case 'updateSettings':
      await updateHousehold(householdId, {
        residentName: b.residentName,
        timezone: b.timezone,
        emergencyNumber: b.emergencyNumber,
      })
      return NextResponse.json({ ok: true })
  }
}
