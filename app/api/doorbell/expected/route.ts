import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { addExpected, removeExpected } from '@/lib/doorbell/store'
import { authorize, parse } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const Add = z.object({
  icon: z.string().max(8),
  label: z.string().min(1).max(40),
  startsAt: z.number().finite(),
  endsAt: z.number().finite(),
}).refine((v) => v.endsAt > v.startsAt)

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res
  const p = await parse(req, Add)
  if (p.ok === false) return p.res
  const { icon, label, startsAt, endsAt } = p.data
  const householdId = a.session!.householdId
  return NextResponse.json({ ok: true, expected: await addExpected(householdId, icon, label, startsAt, endsAt) })
}

export async function DELETE(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res
  const p = await parse(req, z.object({ id: z.string().max(80) }))
  if (p.ok === false) return p.res
  const householdId = a.session!.householdId
  await removeExpected(householdId, p.data.id)
  return NextResponse.json({ ok: true })
}
