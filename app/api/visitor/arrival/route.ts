import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prismaPassStore } from '@/lib/visitor/pass'
import { useVisitorPass } from '@/lib/visitor/binding'
import { hit, clientIp } from '@/lib/ratelimit'
import { sameOrigin } from '@/lib/guard'
import { newDeviceId } from '@/lib/visit-tokens'
import { IS_PROD } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const arrivalSchema = z.object({
  secret: z.string().min(32).max(128),   // from the visitor link
})

/** httpOnly cookie that identifies the visitor's browser. The server issues it; scripts cannot read it. */
const DEV = 'vp_dev'

const MESSAGES = {
  invalid:        'This pass link is not valid.',
  revoked:        'This pass was cancelled.',
  outside_window: 'This pass is not valid right now.',
  wrong_device:   'This pass is already in use on a different device.',
} as const

/**
 * POST /api/visitor/arrival
 * Public (the visitor has no account). Authenticated by the pass secret, and bound to the first
 * browser that uses it (identified by the httpOnly `vp_dev` cookie). Any other browser gets 403.
 */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Cross-origin requests are not allowed' }, { status: 403 })

  // Rate limit before touching the database: guessing secrets must be slow.
  if (!hit(`pass-arrival:ip:${clientIp(request)}`, 20, 10 * 60_000)) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 })
  }

  try {
    const parsed = arrivalSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    const existing     = request.cookies.get(DEV)?.value
    const deviceSecret = existing || newDeviceId()

    const r = await useVisitorPass(prismaPassStore, parsed.data.secret, deviceSecret)
    if (r.ok === false) return NextResponse.json({ error: MESSAGES[r.reason] }, { status: r.status })

    const res = NextResponse.json({ success: true, firstUse: r.firstUse })
    if (!existing) {
      res.cookies.set(DEV, deviceSecret, {
        httpOnly: true, sameSite: 'lax', secure: IS_PROD, path: '/', maxAge: 60 * 60 * 24 * 365,
      })
    }
    return res
  } catch (error) {
    console.error('[ARRIVAL] Error recording arrival:', error)
    return NextResponse.json({ error: 'Failed to record arrival' }, { status: 500 })
  }
}
