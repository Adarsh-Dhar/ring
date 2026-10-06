import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail, parse, cookieOpts } from '@/lib/guard'
import { getDb } from '@/lib/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const HOUSEHOLD_COOKIE = 'db_household'

const Body = z.object({
  householdId: z.string().min(1),
})

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'user')
  if (a.ok === false) return a.res

  const p = await parse(req, Body)
  if (p.ok === false) return p.res

  const { householdId } = p.data
  const userId = a.session!.userId

  const db = getDb()
  try {
    const membership = await db.membership.findFirst({
      where: {
        userId,
        householdId,
        consent: 'approved',
      },
      select: {
        id: true,
        role: true,
      },
    })

    if (!membership) {
      return fail('You are not a member of this household', 403)
    }

    const res = NextResponse.json({
      ok: true,
      role: membership.role,
    })

    res.cookies.set(HOUSEHOLD_COOKIE, householdId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: '/',
    })

    return res
  } catch (e) {
    console.error('[SESSION HOUSEHOLD POST] Failed to set household', e)
    return fail('Unable to set household. Please try again.', 503)
  }
}
