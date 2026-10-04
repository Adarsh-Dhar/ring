import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { visitorView, withdraw } from '@/lib/doorbell/regular'
import { fail, parse, sameOrigin } from '@/lib/guard'
import { hit, clientIp } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ token: string }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  if (!hit(`rv:status:${clientIp(req)}`, 120, 60_000)) return fail('Too many requests', 429)
  const { token } = await ctx.params
  const v = await visitorView(token)
  if (!v) return fail('Not found', 404)
  return NextResponse.json(v, { headers: { 'Cache-Control': 'no-store' } })
}

/** POST {action:'withdraw'}: cancel a pending registration, or erase an approved one. */
export async function POST(req: NextRequest, ctx: Ctx) {
  if (!sameOrigin(req)) return fail('bad origin', 403)
  if (!hit(`rv:act:${clientIp(req)}`, 20, 60_000)) return fail('Too many requests', 429)
  const p = await parse(req, z.object({ action: z.literal('withdraw') }))
  if (p.ok === false) return p.res
  const { token } = await ctx.params
  const r = await withdraw(token)
  return r.ok === false ? fail(r.error, r.status) : NextResponse.json({ ok: true })
}
