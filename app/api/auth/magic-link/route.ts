import { NextRequest, NextResponse } from 'next/server'
import { generateMagicLinkToken, verifyMagicLinkToken, sendMagicLink } from '@/lib/auth/magic-link'
import { getDb } from '@/lib/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/auth/magic-link - Send magic link
 */
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { email } = body

  if (!email) {
    return NextResponse.json({ error: 'email required' }, { status: 400 })
  }

  try {
    const db = getDb()
    const user = await db.user.findUnique({
      where: { email },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Get user's household
    const membership = await db.membership.findFirst({
      where: { userId: user.id },
      include: { household: true },
    })

    if (!membership) {
      return NextResponse.json({ error: 'User not a member of any household' }, { status: 400 })
    }

    // Generate magic link token
    const token = generateMagicLinkToken(user.id, membership.householdId, email, membership.id)
    const magicLinkUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/magic-link/verify?token=${token}`

    // Send magic link via email
    await sendMagicLink(email, magicLinkUrl)

    return NextResponse.json({ success: true, message: 'Magic link sent' })
  } catch (error) {
    console.error('[MAGIC-LINK] Failed to send magic link:', error)
    return NextResponse.json({ error: 'Failed to send magic link' }, { status: 500 })
  }
}

/**
 * GET /api/auth/magic-link/verify - Verify magic link and create session
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')

  if (!token) {
    return NextResponse.json({ error: 'token required' }, { status: 400 })
  }

  try {
    const tokenData = verifyMagicLinkToken(token)

    if (!tokenData) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 400 })
    }

    // Create session token
    const { makeToken } = await import('@/lib/auth')
    const sessionToken = makeToken({
      kind: 'helper',
      sub: tokenData.userId,
      householdId: tokenData.householdId,
      membershipId: tokenData.membershipId,
      userId: tokenData.userId,
      epoch: 1,
      exp: Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60), // 90 days
    })

    // Set cookie
    const response = NextResponse.json({ success: true })
    response.cookies.set('session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 90 * 24 * 60 * 60,
      path: '/',
    })

    return response
  } catch (error) {
    console.error('[MAGIC-LINK] Verification failed:', error)
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 })
  }
}
