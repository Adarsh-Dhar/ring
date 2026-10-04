import { NextRequest, NextResponse } from 'next/server'
import { generatePasskeyAuthenticationOptions, verifyPasskeyAuthentication } from '@/lib/auth/passkey'
import { getDb } from '@/lib/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/auth/passkey/login/options - Get authentication options
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

    const options = await generatePasskeyAuthenticationOptions(user.id)
    return NextResponse.json({ options, userId: user.id })
  } catch (error) {
    console.error('[PASSKEY] Failed to generate authentication options:', error)
    return NextResponse.json({ error: 'Failed to generate options' }, { status: 500 })
  }
}

/**
 * PUT /api/auth/passkey/login/verify - Verify authentication
 */
export async function PUT(request: NextRequest) {
  const body = await request.json()
  const { response, expectedChallenge } = body

  if (!response || !expectedChallenge) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  try {
    const { verification, userId } = await verifyPasskeyAuthentication(response, expectedChallenge)
    
    // Get user's household and role
    const db = getDb()
    const membership = await db.membership.findFirst({
      where: { userId },
      include: { household: true },
    })

    if (!membership) {
      return NextResponse.json({ error: 'User not a member of any household' }, { status: 400 })
    }

    // Create session token
    const { makeToken } = await import('@/lib/auth')
    const sessionToken = makeToken({
      kind: 'helper',
      sub: userId,
      householdId: membership.householdId,
      membershipId: membership.id,
      userId,
      epoch: 1,
      exp: Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60), // 90 days
    })

    const result = NextResponse.json({ 
      verified: true, 
      role: membership.role,
      verification 
    })
    
    result.cookies.set('session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 90 * 24 * 60 * 60,
      path: '/',
    })

    return result
  } catch (error) {
    console.error('[PASSKEY] Authentication verification failed:', error)
    return NextResponse.json({ error: 'Authentication failed' }, { status: 400 })
  }
}
