import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { encrypt } from '@/lib/auth'
import { getDb } from '@/lib/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Ring Partner API Token Exchange Endpoint (server-to-server).
 * Ring POSTs an authorization code here within 60 s of the user authorising.
 * We exchange it for tokens, store them encrypted, and mark the connection
 * 'unclaimed'.  A guardian must then visit /api/ring/link to bind it to their
 * household.
 *
 * This endpoint is intentionally unauthenticated – it is called by Ring's
 * servers, not by end-users.  The security guarantee is that the HMAC
 * signature on the subsequent /api/ring/link callback prevents an attacker
 * from claiming an unclaimed connection they didn't initiate.
 */
export async function POST(request: NextRequest) {
  const clientId     = process.env.RING_CLIENT_ID
  const clientSecret = process.env.RING_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    console.error('[RING TOKEN] Missing RING_CLIENT_ID or RING_CLIENT_SECRET')
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }

  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const schema = z.object({
    code:         z.string().min(1),
    grant_type:   z.literal('authorization_code'),
    redirect_uri: z.string().url(),
  })

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  // Exchange the authorization code with Ring for OAuth tokens
  const tokenUrl = process.env.RING_TOKEN_URL ?? 'https://oauth.ring.com/oauth/token'
  const ringRes  = await fetch(tokenUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type:    'authorization_code',
      code:          parsed.data.code,
      redirect_uri:  parsed.data.redirect_uri,
      client_id:     clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(10_000),
  })

  if (ringRes.ok === false) {
    console.error('[RING TOKEN] Ring token exchange failed', ringRes.status)
    return NextResponse.json({ error: 'invalid_grant' }, { status: 400 })
  }

  const tokens:    Record<string, unknown> = await ringRes.json()
  const accessToken  = tokens.access_token
  const refreshToken = tokens.refresh_token
  const expiresIn    = typeof tokens.expires_in === 'number' ? tokens.expires_in : 3600

  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') {
    console.error('[RING TOKEN] Missing tokens in Ring response')
    return NextResponse.json({ error: 'invalid_response' }, { status: 500 })
  }

  // Retrieve the Ring account ID so we can key the connection record
  const meRes = await fetch('https://api.amazonvision.com/v1/users/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal:  AbortSignal.timeout(10_000),
  })

  if (meRes.ok === false) {
    console.error('[RING TOKEN] Failed to get Ring account ID', meRes.status)
    return NextResponse.json({ error: 'invalid_token' }, { status: 400 })
  }

  const meData: Record<string, unknown> = await meRes.json()
  const ringAccountId = (meData.data as Record<string, unknown> | undefined)?.id

  if (typeof ringAccountId !== 'string') {
    console.error('[RING TOKEN] No account ID in Ring /users/me response')
    return NextResponse.json({ error: 'invalid_response' }, { status: 500 })
  }

  const encryptedAccess  = encrypt(accessToken)
  const encryptedRefresh = encrypt(refreshToken)

  if (!encryptedAccess || !encryptedRefresh) {
    console.error('[RING TOKEN] TOKEN_ENC_KEY not set or invalid – cannot encrypt tokens')
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }

  const expiresAt = new Date(Date.now() + expiresIn * 1000)
  const db        = getDb()

  const existing = await db.ringConnection.findUnique({ where: { ringAccountId } })

  if (existing && existing.status === 'linked') {
    // Re-auth from a known linked account: refresh tokens, keep household
    await db.ringConnection.update({
      where: { ringAccountId },
      data: {
        encryptedAccessToken:  encryptedAccess,
        encryptedRefreshToken: encryptedRefresh,
        expiresAt,
      },
    })
  } else {
    // New or previously unclaimed/revoked: reset to unclaimed
    await db.ringConnection.upsert({
      where:  { ringAccountId },
      update: {
        encryptedAccessToken:  encryptedAccess,
        encryptedRefreshToken: encryptedRefresh,
        expiresAt,
        status:         'unclaimed',
        householdId:    null,
        linkedByUserId: null,
      },
      create: {
        ringAccountId,
        encryptedAccessToken:  encryptedAccess,
        encryptedRefreshToken: encryptedRefresh,
        expiresAt,
        status:      'unclaimed',
        householdId: null,   // nullable FK – set by a guardian via /api/ring/link
      },
    })
  }

  console.log('[RING TOKEN] Connection upserted for account', ringAccountId)
  return NextResponse.json({ success: true })
}
