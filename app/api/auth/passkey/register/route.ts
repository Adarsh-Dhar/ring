import { NextRequest, NextResponse } from 'next/server'
import { generatePasskeyRegistrationOptions, verifyPasskeyRegistration } from '@/lib/auth/passkey'
import { getDb } from '@/lib/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/auth/passkey/register/options - Get registration options
 */
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { userId, userName } = body

  if (!userId) {
    return NextResponse.json({ error: 'userId required' }, { status: 400 })
  }

  try {
    const options = await generatePasskeyRegistrationOptions(userId, userName)
    return NextResponse.json(options)
  } catch (error) {
    console.error('[PASSKEY] Failed to generate registration options:', error)
    return NextResponse.json({ error: 'Failed to generate options' }, { status: 500 })
  }
}

/**
 * PUT /api/auth/passkey/register/verify - Verify registration
 */
export async function PUT(request: NextRequest) {
  const body = await request.json()
  const { userId, response, expectedChallenge } = body

  if (!userId || !response || !expectedChallenge) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  try {
    const verification = await verifyPasskeyRegistration(userId, response, expectedChallenge)
    return NextResponse.json({ verified: true, verification })
  } catch (error) {
    console.error('[PASSKEY] Registration verification failed:', error)
    return NextResponse.json({ error: 'Registration failed' }, { status: 400 })
  }
}
