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
  name:     z.string().trim().min(1, 'Your name is required').max(40).transform(s => s.replace(/[\u0000-\u001f]/g, '')),
  purpose:  z.enum(PURPOSE_KEYS),
  note:     z.string().trim().max(120).optional(),
  contact:  z.string().trim().min(5, 'Contact information is required (min 5 characters)').max(80),
  startsAt: z.number().finite(),
  endsAt:   z.number().finite(),
  website:  z.string().max(0).optional(),  // honeypot: real users leave it empty
})

export async function GET(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params

  if (!hit(`vr:peek:${clientIp(req)}`, 30, 60_000)) {
    return fail('Too many requests. Please wait a moment and try again.', 429)
  }

  let link: any
  try {
    link = await findActiveLinkByHash(hashToken(token))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[VISIT PUBLIC GET]', e)
    return fail(`Unable to verify visit link: ${msg}`, 503)
  }

  if (!link) {
    return fail('This visit request link is no longer active or has expired.', 404)
  }

  return NextResponse.json({
    resident: firstName((link.household as any).residentName),
  })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  if (!sameOrigin(req)) {
    return fail('Cross-origin requests are not allowed.', 403)
  }

  const ip = clientIp(req)
  if (!hit(`vr:create:${ip}`, 10, 60_000)) {
    return fail('Too many requests. Please wait a moment and try again.', 429)
  }

  const p = await parse(req, Body)
  if (p.ok === false) return p.res

  // Honeypot: website field must be empty — pretend success silently
  if (p.data.website) return NextResponse.json({ ok: true, statusToken: 'x' })

  if (p.data.endsAt <= p.data.startsAt) {
    return fail('End time must be after start time.', 400)
  }
  if (p.data.startsAt < Date.now() - 60_000) {
    return fail('Start time cannot be in the past.', 400)
  }

  const { token } = await ctx.params

  let r: Awaited<ReturnType<typeof createVisitRequest>>
  try {
    r = await createVisitRequest({
      linkToken:  token,
      name:       p.data.name,
      purpose:    p.data.purpose,
      note:       p.data.note,
      contactRaw: p.data.contact,
      startsAt:   p.data.startsAt,
      endsAt:     p.data.endsAt,
      ip,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[VISIT PUBLIC POST]', e)
    return fail(`Failed to submit visit request: ${msg}`, 503)
  }

  if (r.ok === false) return fail(r.error, r.status)
  return NextResponse.json({ ok: true, statusToken: r.statusToken })
}
