import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { visitorView, bindDevice, resendLink, cancelOwn } from '@/lib/doorbell/requests'
import { fail, parse, sameOrigin } from '@/lib/guard'
import { hit, clientIp } from '@/lib/ratelimit'
import { IS_PROD } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ token: string }> }

/** Cookie name for the visitor device binding. */
const DEV = 'vr_dev'

export async function GET(req: NextRequest, ctx: Ctx) {
  if (!hit(`vr:status:${clientIp(req)}`, 120, 60_000)) return fail('Too many requests', 429)
  const { token } = await ctx.params
  const v = await visitorView(token, req.cookies.get(DEV)?.value)
  if (!v) return fail('Not found', 404)
  return NextResponse.json(v, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  if (!sameOrigin(req)) return fail('bad origin', 403)
  if (!hit(`vr:act:${clientIp(req)}`, 20, 60_000)) return fail('Too many requests', 429)
  const p = await parse(req, z.object({ action: z.enum(['bind', 'resend', 'cancel']) }))
  if (p.ok === false) return p.res
  const { token } = await ctx.params

  if (p.data.action === 'bind') {
    const r = await bindDevice(token)
    if (r.ok === false) return fail(r.error, r.status)
    const res = NextResponse.json({ ok: true })
    res.cookies.set(DEV, r.cookie, {
      httpOnly: true,
      sameSite: 'lax',
      secure: IS_PROD,
      path: '/',
      maxAge: 60 * 60 * 24 * 14,   // 2 weeks
    })
    return res
  }

  const r = p.data.action === 'resend' ? await resendLink(token) : await cancelOwn(token)
  return r.ok === false ? fail(r.error, r.status) : NextResponse.json({ ok: true })
}
