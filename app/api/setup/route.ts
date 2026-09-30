import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  getSetup, addHelper, removeHelper, moveHelper, setConsent, setQuiet, setTimeoutSec,
  rotateHelper, rotateResident, getHelperEpoch, getResidentEpoch, getHelper,
} from '@/lib/doorbell/store'
import { authorize, fail, parse } from '@/lib/guard'
import { makeToken } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const hour = z.number().int().min(0).max(23)
const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), name: z.string().trim().min(1).max(30), phone: z.string().trim().regex(/^\+\d{8,15}$/), emoji: z.string().max(8).default('🙂') }),
  z.object({ action: z.literal('remove'), id: z.string().max(80) }),
  z.object({ action: z.literal('move'), id: z.string().max(80), dir: z.union([z.literal(-1), z.literal(1)]) }),
  z.object({ action: z.literal('consent'), id: z.string().max(80), consent: z.enum(['approved', 'declined', 'pending']) }),
  z.object({ action: z.literal('quiet'), enabled: z.boolean(), startHour: hour, endHour: hour }),
  z.object({ action: z.literal('timeout'), value: z.number().finite() }),
  // Personal sign-in link for one helper, or for the resident's device.
  z.object({ action: z.literal('link'), target: z.string().max(80) }),
  // Revoke every link ever issued to a helper (or the resident device). Issue a new link afterwards.
  z.object({ action: z.literal('revoke'), target: z.string().max(80) }),
])

export async function GET(req: NextRequest) {
  const a = authorize(req, 'admin')
  if (!a.ok) return a.res
  return NextResponse.json(getSetup())
}

export async function POST(req: NextRequest) {
  const a = authorize(req, 'admin')
  if (!a.ok) return a.res
  const p = await parse(req, Body)
  if (!p.ok) return p.res
  const b = p.data
  switch (b.action) {
    case 'add':
      return NextResponse.json({ ok: true, helper: addHelper(b.name, b.phone, b.emoji) })
    case 'remove':
      return removeHelper(b.id) ? NextResponse.json({ ok: true }) : fail('Keep at least one approved helper')
    case 'move':
      moveHelper(b.id, b.dir)
      return NextResponse.json({ ok: true })
    case 'consent':
      return setConsent(b.id, b.consent) ? NextResponse.json({ ok: true }) : fail('Not found, or it would leave no approved helper')
    case 'quiet':
      setQuiet({ enabled: b.enabled, startHour: b.startHour, endHour: b.endHour })
      return NextResponse.json({ ok: true })
    case 'timeout':
      setTimeoutSec(b.value)
      return NextResponse.json({ ok: true })
    case 'link': {
      const isRes = b.target === 'resident'
      if (!isRes && !getHelper(b.target)) return fail('unknown helper', 404)
      const token = makeToken(isRes ? { role: 'resident', id: 'resident', epoch: getResidentEpoch() } : { role: 'helper', id: b.target, epoch: getHelperEpoch(b.target) })
      if (!token) return fail('AUTH_SECRET is not set on the server', 500)
      const origin = process.env.APP_URL || new URL(req.url).origin
      return NextResponse.json({ ok: true, url: `${origin}/enter?t=${token}` })
    }
    case 'revoke':
      if (b.target === 'resident') { rotateResident(); return NextResponse.json({ ok: true }) }
      return rotateHelper(b.target) ? NextResponse.json({ ok: true }) : fail('unknown helper', 404)
  }
}
