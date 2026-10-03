// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { fail, parse } from '@/lib/guard'
import { encrypt } from '@/lib/auth'
import { getDb } from '@/lib/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Ring Partner API Token Exchange Endpoint
 * Ring will POST to this endpoint with an authorization code to exchange for access tokens.
 * This happens server-to-server within 60 seconds of the user authorizing.
 *
 * The connection is initially created with status 'unclaimed'.
 * The user must then complete the linking flow via /api/ring/link to bind it to their household.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Ring's token exchange request
    const schema = z.object({
      code: z.string(),
      grant_type: z.literal('authorization_code'),
      redirect_uri: z.string().url()
    })

    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      console.error('[RING TOKEN] Invalid request', parsed.error)
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
    }

    // Exchange the authorization code with Ring for tokens
    const tokenUrl = process.env.RING_TOKEN_URL || 'https://oauth.ring.com/oauth/token'
    const clientId = process.env.RING_CLIENT_ID
    const clientSecret = process.env.RING_CLIENT_SECRET

    if (!clientId || !clientSecret) {
      console.error('[RING TOKEN] Missing RING_CLIENT_ID or RING_CLIENT_SECRET')
      return NextResponse.json({ error: 'server_error' }, { status: 500 })
    }

    const ringRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: parsed.data.code,
        redirect_uri: parsed.data.redirect_uri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
      signal: AbortSignal.timeout(10000),
    })

    if (!ringRes.ok) {
      console.error('[RING TOKEN] Ring token exchange failed', ringRes.status)
      return NextResponse.json({ error: 'invalid_grant' }, { status: 400 })
    }

    const tokens = await ringRes.json()
    const accessToken = tokens.access_token
    const refreshToken = tokens.refresh_token
    const expiresIn = tokens.expires_in || 3600

    if (!accessToken || !refreshToken) {
      console.error('[RING TOKEN] Missing tokens in response')
      return NextResponse.json({ error: 'invalid_response' }, { status: 500 })
    }

    // Get the Ring Account ID from the access token
    const meRes = await fetch('https://api.amazonvision.com/v1/users/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10000),
    })

    if (!meRes.ok) {
      console.error('[RING TOKEN] Failed to get Ring account ID', meRes.status)
      return NextResponse.json({ error: 'invalid_token' }, { status: 400 })
    }

    const meData = await meRes.json()
    const ringAccountId = meData.data?.id

    if (!ringAccountId) {
      console.error('[RING TOKEN] No account ID in response')
      return NextResponse.json({ error: 'invalid_response' }, { status: 500 })
    }

    // Encrypt the tokens
    const encryptedAccess = encrypt(accessToken)
    const encryptedRefresh = encrypt(refreshToken)

    if (!encryptedAccess || !encryptedRefresh) {
      console.error('[RING TOKEN] Failed to encrypt tokens')
      return NextResponse.json({ error: 'server_error' }, { status: 500 })
    }

    // Create or update the Ring connection with status 'unclaimed'
    // A connection can only be claimed once by linking it to a household
    const expiresAt = new Date(Date.now() + expiresIn * 1000)

    const db = getDb()
    const connection = await db.ringConnection.upsert({
      where: { ringAccountId },
      update: {
        encryptedAccessToken: encryptedAccess,
        encryptedRefreshToken: encryptedRefresh,
        expiresAt,
        status: 'unclaimed',
        linkedByUserId: null,
      },
      create: {
        ringAccountId,
        encryptedAccessToken: encryptedAccess,
        encryptedRefreshToken: encryptedRefresh,
        expiresAt,
        status: 'unclaimed',
        householdId: '', // Will be set when claimed
      },
    })

    console.log('[RING TOKEN] Connection created/updated', { id: connection.id, ringAccountId })

    // Return success to Ring
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('[RING TOKEN] Error processing request', e)
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }
}
