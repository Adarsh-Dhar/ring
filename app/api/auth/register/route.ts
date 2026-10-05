import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDb } from '@/lib/db/client'
import { hashPassword } from '@/lib/auth/password'
import { normalizeEmail } from '@/lib/identity'
import { makeToken } from '@/lib/auth'
import { COOKIE, cookieOpts } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().optional(),
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

  const { email, password, name } = parsed.data
  const normalizedEmail = normalizeEmail(email)

  try {
    const db = getDb()

    // Check if user already exists
    const existingUser = await db.user.findUnique({
      where: { email: normalizedEmail },
    })

    if (existingUser) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 }
      )
    }

    // Hash password
    const passwordHash = await hashPassword(password)

    // Create user
    const user = await db.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        name: name || null,
      },
    })

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
    })

    res.cookies.set(COOKIE, token, { ...cookieOpts, maxAge: 60 * 60 * 24 * 7 })

    return res
  } catch (error) {
    console.error('[REGISTER ERROR]', error)
    return NextResponse.json(
      { error: 'Failed to create account' },
      { status: 500 }
    )
  }
}
