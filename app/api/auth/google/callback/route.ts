import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getDb } from '@/lib/db/client'
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from '@/lib/google-calendar/config'
import { sign, createSession } from '@/lib/auth'
import { COOKIE, cookieOpts } from '@/lib/guard'
import { normalizeEmail } from '@/lib/identity'
import { encrypt } from '@/lib/auth'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  // Build the base URL from the Host header for redirects
  const host = req.headers.get('host') || 'localhost:3000'
  const protocol = host.includes('localhost') ? 'http' : 'https'
  const baseUrl = `${protocol}://${host}`

  function buildRedirectUrl(path: string): string {
    return `${baseUrl}${path}`
  }

  // Handle user cancellation
  if (error === 'access_denied') {
    return clearStateAndRedirect(buildRedirectUrl('/login?error=cancelled'))
  }

  // Handle other errors
  if (error) {
    console.error('[GOOGLE CALLBACK] OAuth error:', error)
    return clearStateAndRedirect(buildRedirectUrl('/login?error=oauth_error'))
  }

  if (!code || !state) {
    return clearStateAndRedirect(buildRedirectUrl('/login?error=invalid_response'))
  }

  // Verify state and get code verifier and next from cookie
  const oauthState = req.cookies.get('oauth_state')?.value
  console.log('[GOOGLE CALLBACK] OAuth state cookie:', oauthState ? 'present' : 'missing')
  console.log('[GOOGLE CALLBACK] All cookies:', req.cookies.getAll())
  
  if (!oauthState) {
    console.error('[GOOGLE CALLBACK] Missing oauth_state cookie')
    return clearStateAndRedirect(buildRedirectUrl('/login?error=missing_state'))
  }

  let stateData: { s: string; v: string; n: string }
  try {
    stateData = JSON.parse(oauthState)
  } catch (e) {
    console.error('[GOOGLE CALLBACK] Failed to parse state cookie', e)
    return clearStateAndRedirect(buildRedirectUrl('/login?error=invalid_state'))
  }

  // Use timingSafeEqual for state comparison
  const stateBuffer = Buffer.from(state, 'utf8')
  const storedStateBuffer = Buffer.from(stateData.s, 'utf8')
  if (stateBuffer.length !== storedStateBuffer.length || !crypto.timingSafeEqual(new Uint8Array(stateBuffer), new Uint8Array(storedStateBuffer))) {
    console.error('[GOOGLE CALLBACK] State mismatch')
    return clearStateAndRedirect(buildRedirectUrl('/login?error=state_mismatch'))
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

      const res = NextResponse.redirect(new URL(buildRedirectUrl('/login?error=token_exchange_failed')))
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
      const res = NextResponse.redirect(new URL(buildRedirectUrl('/login?error=no_email')))
      res.cookies.set('oauth_state', '', { maxAge: 0, path: '/' })
      return res
    }

    if (!email) {
      const res = NextResponse.redirect(new URL(buildRedirectUrl('/login?error=no_email')))
      res.cookies.set('oauth_state', '', { maxAge: 0, path: '/' })
      return res
    }

    if (!emailVerified) {
      const res = NextResponse.redirect(new URL(buildRedirectUrl('/login?error=email_not_verified')))
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
        // Create new user and store Google tokens for Calendar access
        const encryptedAccessToken = tokens.access_token ? encrypt(tokens.access_token) : null
        const encryptedRefreshToken = tokens.refresh_token ? encrypt(tokens.refresh_token) : null

        user = await db.user.create({
          data: {
            email: normalizedEmail,
            name,
            googleSub,
            googleAccessToken: encryptedAccessToken,
            googleRefreshToken: encryptedRefreshToken,
            googleTokenExpiry: tokens.expires_in ? new Date(Date.now() + (tokens.expires_in * 1000)) : null,
            sessionVersion: 1,
          },
        })
      }
    } else {
      // Update existing user with Google tokens if they don't have them
      if (!user.googleRefreshToken && tokens.access_token && tokens.refresh_token) {
        const encryptedAccessToken = encrypt(tokens.access_token)
        const encryptedRefreshToken = encrypt(tokens.refresh_token)

        if (encryptedAccessToken && encryptedRefreshToken) {
          user = await db.user.update({
            where: { id: user.id },
            data: {
              googleAccessToken: encryptedAccessToken,
              googleRefreshToken: encryptedRefreshToken,
              googleTokenExpiry: new Date(Date.now() + (tokens.expires_in * 1000)),
              sessionVersion: { increment: 1 },
            },
          })
        }
      }
    }

    // Create session
    const session = createSession(user.id, 'user', '', undefined, user.sessionVersion || 1)
    console.log('[GOOGLE CALLBACK] Session created:', session)
    const token = sign(session)
    console.log('[GOOGLE CALLBACK] Token signed:', !!token)

    if (!token) {
      console.error('[GOOGLE CALLBACK] Failed to sign token')
      const res = NextResponse.redirect(new URL(buildRedirectUrl('/login?error=session_creation_failed')))
      res.cookies.set('oauth_state', '', { maxAge: 0, path: '/' })
      return res
    }

    // Set session cookie and redirect
    const redirectTarget = next || '/select-role'
    console.log('[GOOGLE CALLBACK] Redirecting to:', redirectTarget)
    const finalRes = NextResponse.redirect(new URL(buildRedirectUrl(redirectTarget)))
    finalRes.cookies.set(COOKIE, token, cookieOpts)
    finalRes.cookies.set('oauth_state', '', { maxAge: 0, path: '/' })
    console.log('[GOOGLE CALLBACK] Session cookie set')

    return finalRes
  } catch (e) {
    console.error('[GOOGLE CALLBACK] Error:', e)
    const res = NextResponse.redirect(new URL(buildRedirectUrl('/login?error=server_error')))
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
