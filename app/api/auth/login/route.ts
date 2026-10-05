import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { verifyPassword } from '@/lib/auth/password'
import { normalizeEmail } from '@/lib/identity'
import { makeToken } from '@/lib/auth'
import { COOKIE, cookieOpts } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const Body = z.object({
  email: z.string().email(),
  password: z.string(),
})

export async function POST(req: NextRequest) {
  const body = await req.json()
  const parsed = Body.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    )
  }

  const { email, password } = parsed.data
  const normalizedEmail = normalizeEmail(email)

  try {
    const db = getDb()

    // Find user by email
    const user = await db.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        memberships: {
          where: { consent: 'approved' },
          include: {
            household: {
              select: {
                residentName: true,
              },
            },
          },
        },
      },
    })

    if (!user) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      )
    }

    // Verify password
    const isValid = await verifyPassword(password, user.passwordHash)

    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      )
    }

    // Create session token
    const token = makeToken({
      kind: 'user',
      sub: user.id,
      householdId: '',
      epoch: 1,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, // 7 days
    })

    if (!token) {
      return NextResponse.json(
        { error: 'Failed to create session' },
        { status: 500 }
      )
    }

    const res = NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      memberships: user.memberships.map((m) => ({
        id: m.id,
        householdId: m.householdId,
        role: m.role,
        residentName: m.household.residentName,
      })),
      // Include household info for auto-redirect
      hasHousehold: user.memberships.length > 0,
      householdId: user.memberships.length > 0 ? user.memberships[0].householdId : null,
    })

    res.cookies.set(COOKIE, token, { ...cookieOpts, maxAge: 60 * 60 * 24 * 7 })

    return res
  } catch (error) {
    console.error('[LOGIN ERROR]', error)
    return NextResponse.json(
      { error: 'Failed to sign in' },
      { status: 500 }
    )
  }
}
