import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { addSub, removeSub } from '@/lib/doorbell/store'
import { authorize, fail, parse } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const Sub = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
})

// The helper id always comes from the signed session: nobody can subscribe to (or unsubscribe) someone else.
export async function POST(req: NextRequest) {
  const a = authorize(req, 'helper')
  if (!a.ok) return a.res
  const p = await parse(req, z.object({ subscription: Sub }))
  if (!p.ok) return p.res
  addSub((a.session as { helperId: string }).helperId, p.data.subscription)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const a = authorize(req, 'helper')
  if (!a.ok) return a.res
  const p = await parse(req, z.object({ endpoint: z.string().max(1000) }))
  if (!p.ok) return p.res
  removeSub((a.session as { helperId: string }).helperId, p.data.endpoint)
  return NextResponse.json({ ok: true })
}
