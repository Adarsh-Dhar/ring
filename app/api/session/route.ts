import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyToken } from '@/lib/auth'
import { COOKIE, cookieOpts, fail, getSession, parse } from '@/lib/guard'
import { getHelper } from '@/lib/doorbell/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** GET: who am I? (used by the UI) */
export async function GET(req: NextRequest) {
  const s = getSession(req)
  if (!s) return fail('Not signed in', 401)
  return NextResponse.json(s.role === 'helper' ? { role: 'helper', helperId: s.helperId, name: getHelper(s.helperId)?.name } : { role: 'resident' })
}

/** POST {token}: exchange a personal link token for an httpOnly cookie. */
export async function POST(req: NextRequest) {
  const p = await parse(req, z.object({ token: z.string().min(10).max(500) }))
  if (!p.ok) return p.res
  const t = verifyToken(p.data.token)
  if (!t) return fail('This link is not valid any more. Ask for a new link.', 401)
  const res = NextResponse.json({ ok: true, role: t.role })
  res.cookies.set(COOKIE, p.data.token, cookieOpts)
  return res
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(COOKIE, '', { ...cookieOpts, maxAge: 0 })
  return res
}
