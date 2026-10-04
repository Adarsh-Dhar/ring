import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { addExpected, removeExpected } from '@/lib/doorbell/store'
import { authorize, fail, parse } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const Add = z.object({
  icon:       z.string().max(8),
  label:      z.string().min(1).max(40),
  startsAt:   z.number().finite(),
  endsAt:     z.number().finite(),
  who:        z.string().trim().max(40).optional(),
  passphrase: z.string().trim().min(2).max(30).optional(),
}).refine(v => v.endsAt > v.startsAt, {
  message: 'End time must be after start time',
})

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res

  const p = await parse(req, Add)
  if (p.ok === false) return p.res

  const { icon, label, startsAt, endsAt, who, passphrase } = p.data

  if (startsAt < Date.now() - 60_000) {
    return fail('Start time cannot be in the past.', 400)
  }

  let expected: any
  try {
    expected = await addExpected(a.session!.householdId, icon, label, startsAt, endsAt, who, passphrase)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[DOORBELL EXPECTED POST]', e)
    return fail(`Failed to add expected visit: ${msg}`, 503)
  }

  return NextResponse.json({ ok: true, expected })
}

export async function DELETE(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res

  const p = await parse(req, z.object({ id: z.string().min(1).max(80) }))
  if (p.ok === false) return p.res

  try {
    await removeExpected(a.session!.householdId, p.data.id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[DOORBELL EXPECTED DELETE]', e)
    return fail(`Failed to remove expected visit: ${msg}`, 503)
  }

  return NextResponse.json({ ok: true })
}
