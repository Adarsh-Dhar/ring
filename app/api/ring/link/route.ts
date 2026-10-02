import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Ring Partner API Account Link Endpoint
 * Ring will redirect users to this URL for account linking.
 * 
 * For this doorbell helper app, we use direct access tokens (not OAuth flow),
 * so this endpoint returns a 501 to indicate we don't support the OAuth link flow.
 * 
 * If you want to implement full OAuth flow, you would:
 * 1. Redirect to Ring's OAuth authorization URL
 * 2. Handle the callback with authorization code
 * 3. Exchange code for tokens via /api/ring/token
 * 
 * Current implementation: Use RING_REFRESH_TOKEN directly from environment
 */

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const redirectUri = searchParams.get('redirect_uri')
  const state = searchParams.get('state')
  
  console.log('[RING LINK] Account link request received', {
    hasRedirectUri: !!redirectUri,
    hasState: !!state,
  })
  
  // This app uses direct refresh token flow, not OAuth authorization code flow
  // Return a simple HTML page explaining the setup process
  return NextResponse.json(
    {
      error: 'not_implemented',
      message: 'This app uses direct refresh token flow. Set RING_REFRESH_TOKEN in environment variables instead of OAuth.',
      instructions: 'To connect your Ring device:',
      steps: [
        '1. Get your Ring refresh token from Ring Developer Playground',
        '2. Set RING_REFRESH_TOKEN in your environment variables',
        '3. Set RING_CLIENT_ID and RING_CLIENT_SECRET',
        '4. Configure your webhook URL in Ring Developer Console',
      ],
    },
    { status: 501 }
  )
}
