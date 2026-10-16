import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail, parse } from '@/lib/guard'
import { hit } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { decideNote } from '@/lib/ai/agents/compressor'

const Body = z.object({
  action: z.enum(['approve', 'reject']),
  text:   z.string().trim().max(120).optional(),
  icon:   z.string().max(20).optional(),
})

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const a = await authorize(req, 'helper', 'guardian')
  if (a.ok === false) return a.res
  const householdId = a.session.householdId
  if (!householdId) return fail('No household', 400)
  const { id } = await ctx.params
  const p = await parse(req, Body)
  if (p.ok === false) return p.res
  const r = await decideNote(householdId, id, a.session.userId, p.data)
  if (r === null) return fail('Draft not found or already decided', 404)
  if (r === 'invalid') return fail('That wording is not allowed', 422)
  return NextResponse.json({ ok: true, status: r.status })
}
