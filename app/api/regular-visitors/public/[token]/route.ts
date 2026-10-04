import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { findActiveLinkByHash } from '@/lib/db/visit-requests'
import { submitRegistration } from '@/lib/doorbell/regular'
import { fail, parse, sameOrigin } from '@/lib/guard'
import { hit, clientIp } from '@/lib/ratelimit'
import { hashToken } from '@/lib/visit-tokens'
import { PURPOSE_KEYS } from '@/lib/doorbell/purposes'
import { firstName } from '@/lib/visitor-notify'
import { FACE } from '@/face'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ token: string }> }

const Body = z.object({
  name:     z.string().trim().min(1, 'Your name is required').max(40).transform(s => s.replace(/[\u0000-\u001f]/g, '')),
  purpose:  z.enum(PURPOSE_KEYS),
  note:     z.string().trim().max(120).optional(),
  contact:  z.string().trim().min(5, 'Contact information is required (min 5 characters)').max(80),
  image:    z.string().min(100).max(600_000),
  consent:  z.literal(true, { message: 'You must agree before your face is saved' }),
  website:  z.string().max(0).optional(),   // honeypot
})

export async function GET(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params
  if (!hit(`rv:peek:${clientIp(req)}`, 30, 60_000)) return fail('Too many requests. Please wait a moment.', 429)
  let link: any
  try { link = await findActiveLinkByHash(hashToken(token)) }
  catch (e) { console.error('[REGULAR PUBLIC GET]', e); return fail('Unable to verify this link.', 503) }
  if (!link) return fail('This link is no longer active or has expired.', 404)
  return NextResponse.json({ resident: firstName((link.household as any).residentName), enabled: FACE.enabled })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  if (!sameOrigin(req)) return fail('Cross-origin requests are not allowed.', 403)
  if (Number(req.headers.get('content-length') ?? 0) > 1_000_000) return fail('Request too large', 413)

  const ip = clientIp(req)
  if (!hit(`rv:create:${ip}`, 6, 60_000)) return fail('Too many requests. Please wait a moment.', 429)

  const p = await parse(req, Body)
  if (p.ok === false) return p.res
  if (p.data.website) return NextResponse.json({ ok: true, statusToken: 'x' })   // honeypot: pretend success

  const { token } = await ctx.params
  try {
    const r = await submitRegistration({
      linkToken: token, name: p.data.name, purpose: p.data.purpose, note: p.data.note,
      contactRaw: p.data.contact, image: p.data.image, ip,
    })
    if (r.ok === false) return fail(r.error, r.status)
    return NextResponse.json({ ok: true, statusToken: r.statusToken })
  } catch (e) {
    console.error('[REGULAR PUBLIC POST]', e)
    return fail('Could not send your registration. Please try again.', 503)
  }
}
