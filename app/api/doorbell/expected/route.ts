import { NextRequest, NextResponse } from 'next/server'
import { addExpected, removeExpected } from '@/lib/doorbell/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const { icon, label, startsAt, endsAt } = await req.json()
  const ok =
    typeof label === 'string' && label.length > 0 && label.length <= 40 &&
    typeof icon === 'string' && icon.length <= 8 &&
    Number.isFinite(startsAt) && Number.isFinite(endsAt) && endsAt > startsAt
  if (!ok) return NextResponse.json({ error: 'bad request' }, { status: 400 })
  return NextResponse.json({ ok: true, expected: addExpected(icon, label, startsAt, endsAt) })
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json()
  removeExpected(id)
  return NextResponse.json({ ok: true })
}
