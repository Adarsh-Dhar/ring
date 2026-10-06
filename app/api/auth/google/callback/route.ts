import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getDb } from '@/lib/db/client'
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from '@/lib/google-calendar/config'
import { sign, createSession } from '@/lib/auth'
import { COOKIE, cookieOpts } from '@/lib/guard'
import { normalizeEmail } from '@/lib/identity'
import { buildUrl } from '@/lib/redirect'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  // Handle user cancellation
  if (error === 'access_denied') {
    return NextResponse.redirect(new URL(buildUrl('/login?error=cancelled', req.url)))
  }

  // Handle other errors
  if (error) {
    console.error('[GOOGLE CALLBACK] OAuth error:', error)
    return NextResponse.redirect(new URL(buildUrl('/login?error=oauth_error', req.url)))
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL(buildUrl('/login?error=invalid_response', req.url)))
  }

  // Verify state and get code verifier and next from cookie
  const oauthState = req.cookies.get('oauth_state')?.value
  if (!oauthState) {
    return NextResponse.redirect(new URL(buildUrl('/login?error=missing_state', req.url)))
  }

  let stateData: { s: string; v: string; n: string }
  try {
    stateData = JSON.parse(oauthState)
  } catch (e) {
    console.error('[GOOGLE CALLBACK] Failed to parse state cookie', e)
    return NextResponse.redirect(new URL(buildUrl('/login?error=invalid_state', req.url)))
  }

  // Use timingSafeEqual for state comparison
  const stateBuffer = Buffer.from(state, 'utf8')
  const storedStateBuffer = Buffer.from(stateData.s, 'utf8')
  if (stateBuffer.length !== storedStateBuffer.length || !crypto.timingSafeEqual(new Uint8Array(stateBuffer), new Uint8Array(storedStateBuffer))) {
    console.error('[GOOGLE CALLBACK] State mismatch')
    return NextResponse.redirect(new URL(buildUrl('/login?error=state_mismatch', req.url)))
  }

  const codeVerifier = stateData.v
  const next = stateData.n

  try {
    // Exchange code for tokens
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
      console.error('[GOOGLE CALLBACK] Token exchange error:', errorData)
      return NextResponse.redirect(new URL(buildUrl('/login?error=token_exchange_failed', req.url)))
    }

    const tokens = await tokenResponse.json()

    // Get user info from Google
    const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)
    oauth2Client.setCredentials(tokens)
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
    const userInfo = await oauth2.userinfo.get()

    const googleSub = userInfo.data.id
    const email = userInfo.data.email
    const name = userInfo.data.name
    const emailVerified = userInfo.data.verified_email === true

    if (!googleSub) {
      return NextResponse.redirect(new URL(buildUrl('/login?error=no_email', req.url)))
    }

    if (!email) {
      return NextResponse.redirect(new URL(buildUrl('/login?error=no_email', req.url)))
    }

    if (!emailVerified) {
      return NextResponse.redirect(new URL(buildUrl('/login?error=email_not_verified', req.url)))
    }

    // Normalize email
    const normalizedEmail = normalizeEmail(email)

    // Create or update user
    const db = getDb()
    let user = await db.user.findUnique({
      where: { googleSub },
    })

    if (!user) {
      // Only link by email if verified (already checked above)
      user = await db.user.findUnique({
        where: { email: normalizedEmail },
      })

      if (user) {
        // Update existing user with Google info and bump session version
        user = await db.user.update({
          where: { id: user.id },
          data: {
            googleSub,
            sessionVersion: { increment: 1 },
          },
        })
      } else {
        // Create new user (do NOT store Google tokens - those are for Calendar only)
        user = await db.user.create({
          data: {
            email: normalizedEmail,
            name,
            googleSub,
            sessionVersion: 1,
          },
        })
      }
    }
    // Do NOT update Google tokens on login - tokens are only for Calendar

    // Create session
    const session = createSession(user.id, 'user', '', undefined, user.sessionVersion || 1)
    const token = sign(session)

    if (!token) {
      return NextResponse.redirect(new URL(buildUrl('/login?error=session_creation_failed', req.url)))
    }

    // Set session cookie and redirect
    const redirectTarget = next || '/select-role'
    const res = NextResponse.redirect(new URL(redirectTarget, req.url))
    res.cookies.set(COOKIE, token, cookieOpts)

    // Clear oauth state cookie
    res.cookies.set('oauth_state', '', { maxAge: 0, path: '/' })

    return res
  } catch (e) {
    console.error('[GOOGLE CALLBACK] Error:', e)
    return NextResponse.redirect(new URL(buildUrl('/login?error=server_error', req.url)))
  }
}

function getRedirectUri(req: NextRequest): string {
  const host = req.headers.get('host') || 'localhost:3000'
  const protocol = host.includes('localhost') ? 'http' : 'https'
  return `${protocol}://${host}/api/auth/google/callback`
}
