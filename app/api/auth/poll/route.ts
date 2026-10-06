import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getDb } from '@/lib/db/client'
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from '@/lib/google-calendar/config'
import { sign, createSession } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { deviceCode } = body

    if (!deviceCode) {
      return NextResponse.json({ error: 'deviceCode is required' }, { status: 400 })
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      const error = errorData.error
      if (error === 'authorization_pending') {
        return NextResponse.json({ success: false, error: 'authorization_pending' })
      }
      if (error === 'slow_down') {
        return NextResponse.json({ success: false, error: 'slow_down' })
      }
      if (error === 'expired_token') {
        return NextResponse.json({ success: false, error: 'expired_token' })
      }
      if (error === 'invalid_grant') {
        // Device code already exchanged or invalid
        return NextResponse.json({ success: false, error: 'invalid_grant' })
      }
      console.error('[AUTH POLL TOKENS] Google API error:', errorData)
      return NextResponse.json({ error: 'Failed to exchange device code for tokens' }, { status: 503 })
    }

    const tokens = await response.json()

    // Get user info from Google
    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET
    )
    oauth2Client.setCredentials(tokens)
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
    const userInfo = await oauth2.userinfo.get()

    const googleSub = userInfo.data.id
    const email = userInfo.data.email
    const name = userInfo.data.name

    if (!email) {
      return NextResponse.json({ error: 'Email not provided by Google' }, { status: 400 })
    }

    // Create or update user
    const db = getDb()
    let user = await db.user.findUnique({
      where: { googleSub },
    })

    if (!user) {
      // Check if user exists by email (for migration)
      user = await db.user.findUnique({
        where: { email },
      })

      if (user) {
        // Update existing user with Google info
        user = await db.user.update({
          where: { id: user.id },
          data: {
            googleSub,
            googleAccessToken: tokens.access_token,
            googleRefreshToken: tokens.refresh_token,
            googleTokenExpiry: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
          },
        })
      } else {
        // Create new user
        user = await db.user.create({
          data: {
            email,
            name,
            googleSub,
            googleAccessToken: tokens.access_token,
            googleRefreshToken: tokens.refresh_token,
            googleTokenExpiry: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
          },
        })
      }
    } else {
      // Update existing Google user's tokens
      user = await db.user.update({
        where: { id: user.id },
        data: {
          googleAccessToken: tokens.access_token,
          googleRefreshToken: tokens.refresh_token,
          googleTokenExpiry: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
        },
      })
    }

    // Create session
    const session = createSession(user.id, 'user')

    // Set session cookie
    const token = sign(session)
    const httpResponse = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    })

    httpResponse.cookies.set('db_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: '/',
    })

    return httpResponse
  } catch (e: any) {
    console.error('[AUTH POLL TOKENS] Failed to poll for tokens', e)
    return NextResponse.json({ error: 'Failed to exchange device code for tokens' }, { status: 503 })
  }
}
