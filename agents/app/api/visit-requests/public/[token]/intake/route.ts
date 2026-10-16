import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { fail, parse, sameOrigin } from '@/lib/guard'
import { hit, clientIp } from '@/lib/ratelimit'
import { findActiveLinkByHash, getRequestByToken } from '@/lib/db/visit-requests'
import { hashToken } from '@/lib/visit-tokens'
import { startIntake, answerIntake } from '@/lib/ai/agents/intake'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const Body = z.object({ statusToken: z.string().min(8).max(200), answer: z.string().trim().max(300).optional() })

/** Visitor: start (no answer) or answer the follow-up questions. The reply is only ever the next question or "done". */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  if (!sameOrigin(req)) return fail('Cross-origin requests are not allowed', 403)
  const { token } = await ctx.params
  if (!hit(`vr:intake:${clientIp(req)}`, 20, 60_000)) return fail('Too many requests. Please wait a moment.', 429)
  const p = await parse(req, Body)
  if (p.ok === false) return p.res

  const link: any = await findActiveLinkByHash(hashToken(token)).catch(() => null)
  if (!link) return fail('This link is no longer valid', 404)
  const vr: any = await getRequestByToken(p.data.statusToken)
  if (!vr || vr.linkId !== link.id) return fail('Request not found', 404)       // token must belong to THIS link
  if (vr.status !== 'pending') return NextResponse.json({ question: null, done: true })

  const r = p.data.answer === undefined
    ? await startIntake(vr.householdId, vr.id)
    : await answerIntake(vr.householdId, vr.id, p.data.answer)
  if (!r) return NextResponse.json({ question: null, done: true })      // AI off: the request flow continues as before
  return NextResponse.json({ question: r.question, done: r.status !== 'open' })
}
