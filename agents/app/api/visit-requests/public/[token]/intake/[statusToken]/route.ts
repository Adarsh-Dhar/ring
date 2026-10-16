import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { fail } from '@/lib/guard'
import { hit, clientIp } from '@/lib/ratelimit'
import { getDb } from '@/lib/db/client'
import { findActiveLinkByHash, getRequestByToken } from '@/lib/db/visit-requests'
import { hashToken } from '@/lib/visit-tokens'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string; statusToken: string }> }) {
  const { token, statusToken } = await ctx.params
  if (!hit(`vr:intake:get:${clientIp(req)}`, 30, 60_000)) return fail('Too many requests', 429)
  const link: any = await findActiveLinkByHash(hashToken(token)).catch(() => null)
  const vr: any = link ? await getRequestByToken(statusToken) : null
  if (!link || !vr || vr.linkId !== link.id) return fail('Request not found', 404)
  const row = await getDb().visitIntake.findUnique({ where: { requestId: vr.id }, select: { turns: true, status: true } })
  if (!row || row.status !== 'open') return NextResponse.json({ question: null, done: true })
  const turns = row.turns as { q: string; a?: string }[]
  const last = turns[turns.length - 1]
  return NextResponse.json({ question: last && last.a === undefined ? last.q : null, done: false })
}
