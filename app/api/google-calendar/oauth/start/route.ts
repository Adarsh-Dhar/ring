import { NextRequest, NextResponse } from 'next/server'
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from '@/lib/google-calendar/config'
import crypto from 'crypto'
import { safeNext, buildUrl } from '@/lib/redirect'
import { authorize } from '@/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const a = await authorize(req, 'user')
  if (a.ok === false) return a.res

  const { searchParams } = new URL(req.url)
  const h = searchParams.get('h') // householdId

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

  // Get redirect URI
  const redirectUri = getRedirectUri(req)

  // Store state, verifier, and household in httpOnly cookie as JSON
  const stateCookie = JSON.stringify({ s: state, v: codeVerifier, h })
  const res = NextResponse.redirect(
    new URL(
      `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${GOOGLE_CLIENT_ID}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `response_type=code&` +
        `scope=${encodeURIComponent('https://www.googleapis.com/auth/calendar.events')}&` +
        `state=${state}&` +
        `code_challenge=${codeChallenge}&` +
        `code_challenge_method=S256&` +
        `prompt=consent&` +
        `access_type=offline`
    )
  )

  res.cookies.set('calendar_oauth_state', stateCookie, {
    httpOnly: true,
    secure: req.headers.get('host')?.includes('localhost') ? false : true,
    sameSite: 'lax',
    maxAge: 5 * 60,
    path: '/',
    // Don't set domain to allow cross-subdomain cookies
  })

  return res
}

function getRedirectUri(req: NextRequest): string {
  // Use the request host for redirect URI to match the domain the user is accessing from
  const host = req.headers.get('host') || 'localhost:3000'
  const protocol = host.includes('localhost') ? 'http' : 'https'
  return `${protocol}://${host}/api/google-calendar/oauth/callback`
}
