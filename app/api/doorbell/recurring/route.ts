import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { addRecurring, setRecurringPaused, removeRecurring } from '@/lib/doorbell/store'
import { authorize, fail, parse } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const Add = z.object({
  icon:          z.string().max(8),
  label:         z.string().min(1).max(40),
  days:          z.array(z.number().int().min(0).max(6)).min(1).max(7),
  everyNWeeks:   z.number().int().min(1).max(8).default(1),
  startMin:      z.number().int().min(0).max(1439),
  endMin:        z.number().int().min(1).max(1440),
  alertIfMissed: z.boolean().default(false),
  startNextWeek: z.boolean().default(false),
  who:           z.string().trim().max(40).optional(),
  passphrase:    z.string().trim().min(2).max(30).optional(),
}).refine(v => v.endMin > v.startMin, {
  message: 'End time must be after start time',
})

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res

  const p = await parse(req, Add)
  if (p.ok === false) return p.res

  let recurring: any
  try {
    recurring = await addRecurring(a.session!.householdId, p.data)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[DOORBELL RECURRING POST]', e)
    return fail(`Failed to add recurring visit: ${msg}`, 503)
  }

  return NextResponse.json({ ok: true, recurring })
}

export async function PATCH(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res

  const p = await parse(req, z.object({
    id:     z.string().min(1).max(80),
    paused: z.boolean(),
  }))
  if (p.ok === false) return p.res

  try {
    await setRecurringPaused(a.session!.householdId, p.data.id, p.data.paused)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[DOORBELL RECURRING PATCH]', e)
    return fail(`Failed to ${p.data.paused ? 'pause' : 'resume'} recurring visit: ${msg}`, 503)
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res

  const p = await parse(req, z.object({ id: z.string().min(1).max(80) }))
  if (p.ok === false) return p.res

  try {
    await removeRecurring(a.session!.householdId, p.data.id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[DOORBELL RECURRING DELETE]', e)
    return fail(`Failed to remove recurring visit: ${msg}`, 503)
  }

  return NextResponse.json({ ok: true })
}
