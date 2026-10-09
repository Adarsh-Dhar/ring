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

  // If user already has a valid session, redirect to select-role immediately
  // This prevents duplicate OAuth processing from multiple callback requests
  const existingSession = req.cookies.get('db_session')?.value
  if (existingSession && !error) {
    console.log('[GOOGLE CALLBACK] User already has session, redirecting to select-role')
    return NextResponse.redirect(new URL(buildUrl('/select-role', req.url)))
  }

  // Handle user cancellation
  if (error === 'access_denied') {
    return clearStateAndRedirect(buildUrl('/login?error=cancelled', req.url))
  }

  // Handle other errors
  if (error) {
    console.error('[GOOGLE CALLBACK] OAuth error:', error)
    return clearStateAndRedirect(buildUrl('/login?error=oauth_error', req.url))
  }

  if (!code || !state) {
    return clearStateAndRedirect(buildUrl('/login?error=invalid_response', req.url))
  }

  // Verify state and get code verifier and next from cookie
  const oauthState = req.cookies.get('oauth_state')?.value
  console.log('[GOOGLE CALLBACK] OAuth state cookie:', oauthState ? 'present' : 'missing')
  console.log('[GOOGLE CALLBACK] All cookies:', req.cookies.getAll())
  
  if (!oauthState) {
    console.error('[GOOGLE CALLBACK] Missing oauth_state cookie')
    return clearStateAndRedirect(buildUrl('/login?error=missing_state', req.url))
  }

  let stateData: { s: string; v: string; n: string }
  try {
    stateData = JSON.parse(oauthState)
  } catch (e) {
    console.error('[GOOGLE CALLBACK] Failed to parse state cookie', e)
    return clearStateAndRedirect(buildUrl('/login?error=invalid_state', req.url))
  }

  // Use timingSafeEqual for state comparison
  const stateBuffer = Buffer.from(state, 'utf8')
  const storedStateBuffer = Buffer.from(stateData.s, 'utf8')
  if (stateBuffer.length !== storedStateBuffer.length || !crypto.timingSafeEqual(new Uint8Array(stateBuffer), new Uint8Array(storedStateBuffer))) {
    console.error('[GOOGLE CALLBACK] State mismatch')
    return clearStateAndRedirect(buildUrl('/login?error=state_mismatch', req.url))
  }

  const codeVerifier = stateData.v
  const next = stateData.n

  try {
    // Exchange code for tokens with PKCE
    const redirectUri = getRedirectUri(req)
    console.log('[GOOGLE CALLBACK] Exchanging token, redirect_uri:', redirectUri)
    
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    })

    const responseText = await tokenResponse.text()
    console.log('[GOOGLE CALLBACK] Token exchange response body:', responseText)
    
    if (!tokenResponse.ok) {
      const errorData = JSON.parse(responseText)
      console.error('[GOOGLE CALLBACK] Token exchange error:', errorData)
      console.error('[GOOGLE CALLBACK] Redirect URI used:', redirectUri)
      console.error('[GOOGLE CALLBACK] Code length:', code?.length)

      const res = NextResponse.redirect(new URL(buildUrl('/login?error=token_exchange_failed', req.url)))
      res.cookies.set('oauth_state', '', { maxAge: 0, path: '/' })
      return res
    }

    const tokens = JSON.parse(responseText)
    console.log('[GOOGLE CALLBACK] Tokens received successfully')

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
      const res = NextResponse.redirect(new URL(buildUrl('/login?error=no_email', req.url)))
      res.cookies.set('oauth_state', '', { maxAge: 0, path: '/' })
      return res
    }

    if (!email) {
      const res = NextResponse.redirect(new URL(buildUrl('/login?error=no_email', req.url)))
      res.cookies.set('oauth_state', '', { maxAge: 0, path: '/' })
      return res
    }

    if (!emailVerified) {
      const res = NextResponse.redirect(new URL(buildUrl('/login?error=email_not_verified', req.url)))
      res.cookies.set('oauth_state', '', { maxAge: 0, path: '/' })
      return res
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
      const res = NextResponse.redirect(new URL(buildUrl('/login?error=session_creation_failed', req.url)))
      res.cookies.set('oauth_state', '', { maxAge: 0, path: '/' })
      return res
    }

    // Set session cookie and redirect
    const redirectTarget = next || '/select-role'
    const finalRes = NextResponse.redirect(new URL(redirectTarget, req.url))
    finalRes.cookies.set(COOKIE, token, cookieOpts)
    finalRes.cookies.set('oauth_state', '', { maxAge: 0, path: '/' })

    return finalRes
  } catch (e) {
    console.error('[GOOGLE CALLBACK] Error:', e)
    const res = NextResponse.redirect(new URL(buildUrl('/login?error=server_error', req.url)))
    res.cookies.set('oauth_state', '', { maxAge: 0, path: '/' })
    return res
  }
}

function clearStateAndRedirect(url: string): NextResponse {
  const res = NextResponse.redirect(new URL(url))
  res.cookies.set('oauth_state', '', { maxAge: 0, path: '/' })
  return res
}

function getRedirectUri(req: NextRequest): string {
  // Use the request host for redirect URI to match the domain the user is accessing from
  const host = req.headers.get('host') || 'localhost:3000'
  const protocol = host.includes('localhost') ? 'http' : 'https'
  return `${protocol}://${host}/api/auth/google/callback`
}
