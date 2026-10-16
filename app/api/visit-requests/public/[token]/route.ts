import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { findActiveLinkByHash } from '@/lib/db/visit-requests'
import { createVisitRequest } from '@/lib/doorbell/requests'
import { fail, parse, sameOrigin } from '@/lib/guard'
import { hit, clientIp } from '@/lib/ratelimit'
import { hashToken } from '@/lib/visit-tokens'
import { PURPOSE_KEYS } from '@/lib/doorbell/purposes'
import { firstName } from '@/lib/visitor-notify'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ token: string }> }

const Body = z.object({
  name:    z.string().trim().min(1).max(40).transform(s => s.replace(/[\u0000-\u001f]/g, '')),
  purpose: z.enum(PURPOSE_KEYS),
  note:    z.string().trim().max(120).optional(),
  contact: z.string().trim().min(5).max(80),
  startsAt: z.number().finite(),
  endsAt:   z.number().finite(),
  website: z.string().max(0).optional(),    // honeypot: real users leave it empty
})

export async function GET(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params
  if (!hit(`vr:peek:${clientIp(req)}`, 30, 60_000)) return fail('Too many requests', 429)
  const link = await findActiveLinkByHash(hashToken(token))
  if (!link) return fail('This link is no longer active.', 404)
  return NextResponse.json({ resident: firstName((link.household as any).residentName) })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  if (!sameOrigin(req)) return fail('bad origin', 403)
  const ip = clientIp(req)
  if (!hit(`vr:create:${ip}`, 10, 60_000)) return fail('Too many requests', 429)
  const p = await parse(req, Body)
  if (p.ok === false) return p.res
  // Honeypot: website field must be empty — pretend success silently
  if (p.data.website) return NextResponse.json({ ok: true, statusToken: 'x' })
  const { token } = await ctx.params
  const r = await createVisitRequest({
    linkToken:   token,
    name:        p.data.name,
    purpose:     p.data.purpose,
    note:        p.data.note,
    contactRaw:  p.data.contact,
    startsAt:    p.data.startsAt,
    endsAt:      p.data.endsAt,
    ip,
  })
  if (r.ok === false) return fail(r.error, r.status)
  return NextResponse.json({ ok: true, statusToken: r.statusToken })
}
