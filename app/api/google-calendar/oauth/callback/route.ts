import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getDb } from '@/lib/db/client'
import { authorize } from '@/lib/guard'
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from '@/lib/google-calendar/config'
import { encrypt } from '@/lib/auth'
import { buildUrl } from '@/lib/redirect'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const a = await authorize(req, 'user')
  if (a.ok === false) return a.res

  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')
  const h = searchParams.get('h') // householdId

  if (error === 'access_denied') {
    const target = h ? `/workspace/${h}?error=calendar_cancelled` : '/login?error=calendar_cancelled'
    return NextResponse.redirect(new URL(buildUrl(target, req.url)))
  }

  if (error) {
    console.error('[CALENDAR OAUTH] OAuth error:', error)
    const target = h ? `/workspace/${h}?error=calendar_oauth_error` : '/login?error=calendar_oauth_error'
    return NextResponse.redirect(new URL(buildUrl(target, req.url)))
  }

  if (!code || !state) {
    const target = h ? `/workspace/${h}?error=invalid_response` : '/login?error=invalid_response'
    return NextResponse.redirect(new URL(buildUrl(target, req.url)))
  }

  const oauthState = req.cookies.get('calendar_oauth_state')?.value
  if (!oauthState) {
    return NextResponse.redirect(new URL(buildUrl('/login?error=missing_state', req.url)))
  }

  let stateData: { s: string; h: string }
  try {
    stateData = JSON.parse(oauthState)
  } catch (e) {
    console.error('[CALENDAR OAUTH] Failed to parse state cookie', e)
    const target = h ? `/workspace/${h}?error=invalid_state` : '/login?error=invalid_state'
    return NextResponse.redirect(new URL(buildUrl(target, req.url)))
  }

  const stateBuffer = Buffer.from(state, 'utf8')
  const storedStateBuffer = Buffer.from(stateData.s, 'utf8')
  if (stateBuffer.length !== storedStateBuffer.length || !crypto.timingSafeEqual(new Uint8Array(stateBuffer), new Uint8Array(storedStateBuffer))) {
    console.error('[CALENDAR OAUTH] State mismatch')
    const target = h ? `/workspace/${h}?error=state_mismatch` : '/login?error=state_mismatch'
    return NextResponse.redirect(new URL(buildUrl(target, req.url)))
  }

  const householdId = stateData.h

  try {
    // Exchange code for tokens (without PKCE for TV/Limited Input devices)
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: getRedirectUri(req),
      }),
    })

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json()
      console.error('[CALENDAR OAUTH] Token exchange error:', errorData)
      return NextResponse.redirect(new URL('/workspace/helper?error=token_exchange_failed', req.url))
    }

    const tokens = await tokenResponse.json()

    // Verify the returned sub matches the signed-in user's googleSub
    const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)
    oauth2Client.setCredentials(tokens)
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
    const userInfo = await oauth2.userinfo.get()

    const googleSub = userInfo.data.id

    const db = getDb()
    const user = await db.user.findUnique({
      where: { id: a.session!.userId },
      select: { googleSub: true }
    })

    if (!user || user.googleSub !== googleSub) {
      const target = householdId ? `/workspace/${householdId}?error=account_mismatch` : '/login?error=account_mismatch'
      return NextResponse.redirect(new URL(buildUrl(target, req.url)))
    }

    // Encrypt tokens before storing
    const encryptedAccessToken = encrypt(tokens.access_token)
    const encryptedRefreshToken = tokens.refresh_token ? encrypt(tokens.refresh_token) : null

    if (!encryptedAccessToken) {
      const target = householdId ? `/workspace/${householdId}?error=encryption_failed` : '/login?error=encryption_failed'
      return NextResponse.redirect(new URL(buildUrl(target, req.url)))
    }

    // Store encrypted tokens
    await db.user.update({
      where: { id: a.session!.userId },
      data: {
        googleAccessToken: encryptedAccessToken,
        googleRefreshToken: encryptedRefreshToken,
        googleTokenExpiry: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
      },
    })

    const target = householdId ? `/workspace/${householdId}?calendar=connected` : '/login?calendar=connected'
    const res = NextResponse.redirect(new URL(buildUrl(target, req.url)))
    res.cookies.set('calendar_oauth_state', '', { maxAge: 0, path: '/' })

    return res
  } catch (e) {
    console.error('[CALENDAR OAUTH] Error:', e)
    const target = householdId ? `/workspace/${householdId}?error=server_error` : '/login?error=server_error'
    return NextResponse.redirect(new URL(buildUrl(target, req.url)))
  }
}

function getRedirectUri(req: NextRequest): string {
  // Use APP_URL from environment for OAuth redirect URI
  // Google OAuth doesn't allow private IP addresses like 192.168.x.x
  const appUrl = process.env.APP_URL
  if (appUrl) {
    return `${appUrl}/api/google-calendar/oauth/callback`
  }
  
  // Fallback to request-based construction for development
  const host = req.headers.get('host') || 'localhost:3000'
  const protocol = host.includes('localhost') ? 'http' : 'https'
  return `${protocol}://${host}/api/google-calendar/oauth/callback`
}
