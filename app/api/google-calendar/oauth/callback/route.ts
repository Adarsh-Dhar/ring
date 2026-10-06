import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getDb } from '@/lib/db/client'
import { authorize } from '@/lib/guard'
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from '@/lib/google-calendar/config'
import { encrypt } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const a = await authorize(req, 'user')
  if (a.ok === false) return a.res

  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  if (error === 'access_denied') {
    return NextResponse.redirect(new URL('/workspace/helper?error=calendar_cancelled', req.url))
  }

  if (error) {
    console.error('[CALENDAR OAUTH] OAuth error:', error)
    return NextResponse.redirect(new URL('/workspace/helper?error=calendar_oauth_error', req.url))
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL('/workspace/helper?error=invalid_response', req.url))
  }

  const oauthState = req.cookies.get('calendar_oauth_state')?.value
  if (!oauthState) {
    return NextResponse.redirect(new URL('/workspace/helper?error=missing_state', req.url))
  }

  const [storedState, codeVerifier] = oauthState.split('.')
  if (storedState !== state) {
    console.error('[CALENDAR OAUTH] State mismatch')
    return NextResponse.redirect(new URL('/workspace/helper?error=state_mismatch', req.url))
  }

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: getRedirectUri(req),
        code_verifier: codeVerifier,
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
      return NextResponse.redirect(new URL('/workspace/helper?error=account_mismatch', req.url))
    }

    // Encrypt tokens before storing
    const encryptedAccessToken = encrypt(tokens.access_token)
    const encryptedRefreshToken = tokens.refresh_token ? encrypt(tokens.refresh_token) : null

    if (!encryptedAccessToken) {
      return NextResponse.redirect(new URL('/workspace/helper?error=encryption_failed', req.url))
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

    const res = NextResponse.redirect(new URL('/workspace/helper?calendar=connected', req.url))
    res.cookies.set('calendar_oauth_state', '', { maxAge: 0, path: '/' })

    return res
  } catch (e) {
    console.error('[CALENDAR OAUTH] Error:', e)
    return NextResponse.redirect(new URL('/workspace/helper?error=server_error', req.url))
  }
}

function getRedirectUri(req: NextRequest): string {
  const host = req.headers.get('host') || 'localhost:3000'
  const protocol = host.includes('localhost') ? 'http' : 'https'
  return `${protocol}://${host}/api/google-calendar/oauth/callback`
}
