import { NextRequest, NextResponse } from 'next/server'
import { authorize, fail } from '@/lib/guard'
import { getDb } from '@/lib/db/client'
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from '@/lib/google-calendar/config'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'any')
  if (a.ok === false) return a.res

  const body = await req.json()
  const { deviceCode } = body

  if (!deviceCode) {
    return fail('deviceCode is required', 400)
  }

  try {
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
      console.error('[GOOGLE CALENDAR POLL TOKENS] Google API error:', errorData)
      return fail('Failed to exchange device code for tokens', 503)
    }

    const tokens = await response.json()

    // Store tokens in database
    const db = getDb()
    await db.user.update({
      where: { id: a.session!.userId },
      data: {
        googleAccessToken: tokens.access_token,
        googleRefreshToken: tokens.refresh_token,
        googleTokenExpiry: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
      },
    })

    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error('[GOOGLE CALENDAR POLL TOKENS] Failed to poll for tokens', e)
    return fail('Failed to exchange device code for tokens', 503)
  }
}
