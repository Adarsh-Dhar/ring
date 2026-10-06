import { NextRequest, NextResponse } from 'next/server'
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from '@/lib/google-calendar/config'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return NextResponse.json({ error: 'Google OAuth credentials not configured' }, { status: 500 })
  }

  try {
    const response = await fetch('https://oauth2.googleapis.com/device/code', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        scope: 'openid email profile',
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[AUTH DEVICE AUTH] Google API error:', errorText)
      return NextResponse.json({ error: 'Failed to initiate device authorization' }, { status: 503 })
    }

    const data = await response.json()
    return NextResponse.json({
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUrl: data.verification_url,
      expiresIn: data.expires_in,
      interval: data.interval,
    })
  } catch (e) {
    console.error('[AUTH DEVICE AUTH] Failed to get device code', e)
    return NextResponse.json({ error: 'Failed to initiate device authorization' }, { status: 503 })
  }
}
