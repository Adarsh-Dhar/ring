import { NextRequest, NextResponse } from 'next/server'
import { authorize, fail } from '@/lib/guard'
import { photoFor } from '@/lib/doorbell/regular'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

/** The photo of a PENDING registration, for the person deciding. Gone as soon as it is decided. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const a = await authorize(req, 'helper', 'resident')
  if (a.ok === false) return a.res
  const { id } = await ctx.params
  const p = await photoFor(a.session.householdId, id)
  if (!p) return fail('Not found', 404)
  return new NextResponse(new Uint8Array(p.bytes), {
    headers: { 'Content-Type': p.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  })
}
