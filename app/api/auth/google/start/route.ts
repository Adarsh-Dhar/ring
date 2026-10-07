import { NextRequest, NextResponse } from 'next/server'
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from '@/lib/google-calendar/config'
import crypto from 'crypto'
import { safeNext, buildUrl } from '@/lib/redirect'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const next = searchParams.get('next')

  const safeNextParam = safeNext(next)

  // Validate credentials at startup
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return NextResponse.json(
      { error: 'Google OAuth credentials not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.' },
      { status: 500 }
    )
  }

  // Generate state for CSRF protection
  const state = crypto.randomBytes(32).toString('base64url')

  // Generate PKCE code verifier and challenge
  const codeVerifier = crypto.randomBytes(32).toString('base64url')
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')

  // Get redirect URI
  const redirectUri = getRedirectUri(req)

  // Store state, verifier, and next in httpOnly cookie as JSON
  const stateCookie = JSON.stringify({ s: state, v: codeVerifier, n: safeNextParam })
  const res = NextResponse.redirect(
    new URL(
      `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${GOOGLE_CLIENT_ID}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `response_type=code&` +
        `scope=${encodeURIComponent('openid email profile')}&` +
        `state=${state}&` +
        `code_challenge=${codeChallenge}&` +
        `code_challenge_method=S256&` +
        `prompt=select_account`
    )
  )

  // Set cookie with state and next (5 minute expiry)
  // Don't set domain for tunnel environments to allow cross-subdomain cookies
  const requestHost = req.headers.get('host') || 'localhost:3000'
  const isLocal = requestHost.includes('localhost') || requestHost.includes('192.168.')
  
  console.log('[GOOGLE START] Setting oauth_state cookie, requestHost:', requestHost, 'isLocal:', isLocal)
  
  res.cookies.set('oauth_state', stateCookie, {
    httpOnly: true,
    secure: !isLocal,
    sameSite: 'lax',
    maxAge: 5 * 60,
    path: '/',
    // Don't set domain for tunnels to allow cross-subdomain cookies
  })

  return res
}

function getRedirectUri(req: NextRequest): string {
  // Use the request host for redirect URI to match the domain the user is accessing from
  // This ensures cookies work correctly with tunnels
  const host = req.headers.get('host') || 'localhost:3000'
  const protocol = host.includes('localhost') ? 'http' : 'https'
  return `${protocol}://${host}/api/auth/google/callback`
}
