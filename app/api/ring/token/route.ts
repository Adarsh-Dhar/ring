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
 * 'unclaimed'. A guardian must then visit /api/ring/link to bind it to their
 * household.
 *
 * This endpoint is intentionally unauthenticated — it is called by Ring's
 * servers, not by end-users. Security is enforced by the HMAC signature on
 * the subsequent /api/ring/link callback.
 */
export async function POST(request: NextRequest) {
  const clientId     = process.env.RING_CLIENT_ID
  const clientSecret = process.env.RING_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    console.error('[RING TOKEN] Missing RING_CLIENT_ID or RING_CLIENT_SECRET env vars')
    return NextResponse.json(
      { error: 'server_error', error_description: 'Ring OAuth credentials are not configured on this server.' },
      { status: 500 }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Request body must be valid JSON.' },
      { status: 400 }
    )
  }

  const schema = z.object({
    code:         z.string().min(1),
    grant_type:   z.literal('authorization_code'),
    redirect_uri: z.string().url(),
  })

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
    return NextResponse.json(
      { error: 'invalid_request', error_description: `Validation failed: ${issues}` },
      { status: 400 }
    )
  }

  // Exchange the authorization code with Ring for OAuth tokens
  const tokenUrl = process.env.RING_TOKEN_URL ?? 'https://oauth.ring.com/oauth/token'
  let ringRes: Response
  try {
    ringRes = await fetch(tokenUrl, {
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
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[RING TOKEN] Network request to Ring token endpoint failed', e)
    return NextResponse.json(
      { error: 'server_error', error_description: `Could not reach Ring token endpoint: ${msg}` },
      { status: 502 }
    )
  }

  if (!ringRes.ok) {
    const body = await ringRes.text().catch(() => '(unreadable)')
    console.error('[RING TOKEN] Ring token exchange failed', ringRes.status, body)
    return NextResponse.json(
      { error: 'invalid_grant', error_description: `Ring rejected the authorization code (HTTP ${ringRes.status}).` },
      { status: 400 }
    )
  }

  let tokens: Record<string, unknown>
  try {
    tokens = await ringRes.json()
  } catch {
    console.error('[RING TOKEN] Could not parse Ring token response as JSON')
    return NextResponse.json(
      { error: 'invalid_response', error_description: 'Ring returned an unexpected response format.' },
      { status: 500 }
    )
  }

  const accessToken  = tokens.access_token
  const refreshToken = tokens.refresh_token
  const expiresIn    = typeof tokens.expires_in === 'number' ? tokens.expires_in : 3600

  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') {
    console.error('[RING TOKEN] Missing access_token or refresh_token in Ring response', tokens)
    return NextResponse.json(
      { error: 'invalid_response', error_description: 'Ring response did not include expected token fields.' },
      { status: 500 }
    )
  }

  // Retrieve the Ring account ID
  const apiBase = (process.env.RING_API_BASE ?? 'https://api.amazonvision.com').replace(/\/$/, '')
  let meRes: Response
  try {
    meRes = await fetch(`${apiBase}/v1/users/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal:  AbortSignal.timeout(10_000),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[RING TOKEN] Network request to Ring /users/me failed', e)
    return NextResponse.json(
      { error: 'server_error', error_description: `Could not reach Ring API to get account ID: ${msg}` },
      { status: 502 }
    )
  }

  if (!meRes.ok) {
    console.error('[RING TOKEN] Failed to fetch Ring account ID', meRes.status)
    return NextResponse.json(
      { error: 'invalid_token', error_description: `Could not retrieve Ring account details (HTTP ${meRes.status}).` },
      { status: 400 }
    )
  }

  let meData: Record<string, unknown>
  try {
    meData = await meRes.json()
  } catch {
    console.error('[RING TOKEN] Could not parse Ring /users/me response as JSON')
    return NextResponse.json(
      { error: 'invalid_response', error_description: 'Ring /users/me returned an unexpected response format.' },
      { status: 500 }
    )
  }

  const ringAccountId = (meData.data as Record<string, unknown> | undefined)?.id
  if (typeof ringAccountId !== 'string') {
    console.error('[RING TOKEN] No account ID in Ring /users/me response', meData)
    return NextResponse.json(
      { error: 'invalid_response', error_description: 'Ring account ID was missing from the API response.' },
      { status: 500 }
    )
  }

  const encryptedAccess  = encrypt(accessToken)
  const encryptedRefresh = encrypt(refreshToken)

  if (!encryptedAccess || !encryptedRefresh) {
    console.error('[RING TOKEN] TOKEN_ENC_KEY is not set or is invalid — cannot encrypt Ring tokens')
    return NextResponse.json(
      { error: 'server_error', error_description: 'Server encryption key is not configured. Set TOKEN_ENC_KEY.' },
      { status: 500 }
    )
  }

  const expiresAt = new Date(Date.now() + expiresIn * 1000)

  let db
  try {
    db = getDb()
  } catch (e) {
    console.error('[RING TOKEN] Failed to get database connection', e)
    return NextResponse.json(
      { error: 'server_error', error_description: 'Database is unavailable.' },
      { status: 503 }
    )
  }

  try {
    const existing = await db.ringConnection.findUnique({ where: { ringAccountId } })

    if (existing && existing.status === 'linked') {
      await db.ringConnection.update({
        where: { ringAccountId },
        data:  { encryptedAccessToken: encryptedAccess, encryptedRefreshToken: encryptedRefresh, expiresAt },
      })
    } else {
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
          householdId: null,
        },
      })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[RING TOKEN] Failed to store Ring connection', e)
    return NextResponse.json(
      { error: 'server_error', error_description: `Failed to store Ring connection: ${msg}` },
      { status: 503 }
    )
  }

  console.log('[RING TOKEN] Connection upserted for account', ringAccountId)
  return NextResponse.json({ success: true })
}
