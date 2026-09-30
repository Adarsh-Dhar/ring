import { NextRequest, NextResponse } from 'next/server'
import { addSub, removeSub } from '@/lib/doorbell/store'
import { HELPERS } from '@/lib/doorbell/config'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const { helperId, subscription } = await req.json()
  if (!HELPERS.some((h) => h.id === helperId) || !subscription?.endpoint || !subscription?.keys) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 })
  }
  addSub(helperId, subscription)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const { helperId, endpoint } = await req.json()
  removeSub(helperId, endpoint)
  return NextResponse.json({ ok: true })
}
