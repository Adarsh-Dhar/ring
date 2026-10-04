import { NextRequest, NextResponse } from 'next/server'
import { verifyMagicLink, sendMagicLink } from '@/lib/auth/magic-link'
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
    // Generate magic link
    const { loginUrl } = await sendMagicLink(email)

    return NextResponse.json({ success: true, loginUrl })
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
    const result = await verifyMagicLink(token)

    if (!result.success || !result.userId) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 400 })
    }

    // Get user's household
    const db = getDb()
    const membership = await db.membership.findFirst({
      where: { userId: result.userId },
      include: { household: true },
    })

    if (!membership) {
      return NextResponse.json({ error: 'User not a member of any household' }, { status: 400 })
    }

    // Create session token
    const { makeToken } = await import('@/lib/auth')
    const sessionToken = makeToken({
      kind: 'helper',
      sub: membership.id,
      householdId: membership.householdId,
      membershipId: membership.id,
      userId: result.userId,
      epoch: 1,
      exp: Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60), // 90 days
    })

    // Set cookie
    const response = NextResponse.json({ success: true })
    response.cookies.set('db_session', sessionToken, {
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
