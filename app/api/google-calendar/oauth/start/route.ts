import { NextRequest, NextResponse } from 'next/server'
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from '@/lib/google-calendar/config'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return NextResponse.json(
      { error: 'Google OAuth credentials not configured' },
      { status: 500 }
    )
  }

  // Generate state for CSRF protection
  const state = crypto.randomBytes(32).toString('base64url')

  // Generate PKCE code verifier and challenge
  const codeVerifier = crypto.randomBytes(32).toString('base64url')
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')

  // Store state and verifier in httpOnly cookie
  const oauthState = `${state}.${codeVerifier}`
  const res = NextResponse.redirect(
    new URL(
      `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${GOOGLE_CLIENT_ID}&` +
        `redirect_uri=${encodeURIComponent(getRedirectUri(req))}&` +
        `response_type=code&` +
        `scope=${encodeURIComponent('https://www.googleapis.com/auth/calendar.events')}&` +
        `state=${state}&` +
        `code_challenge=${codeChallenge}&` +
        `code_challenge_method=S256&` +
        `prompt=consent&` +
        `access_type=offline`
    )
  )

  res.cookies.set('calendar_oauth_state', oauthState, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 5 * 60,
    path: '/',
  })

  return res
}

function getRedirectUri(req: NextRequest): string {
  const host = req.headers.get('host') || 'localhost:3000'
  const protocol = host.includes('localhost') ? 'http' : 'https'
  return `${protocol}://${host}/api/google-calendar/oauth/callback`
}
