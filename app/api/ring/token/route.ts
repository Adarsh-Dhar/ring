import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Ring Partner API Token Exchange Endpoint
 * Ring will POST to this endpoint with an authorization code to exchange for access tokens.
 * 
 * Required Ring Partner API fields:
 * - Account Link URL: https://your-app.vercel.app/api/ring/link
 * - App Homepage URL: https://your-app.vercel.app/
 * - Token Exchange URL: https://your-app.vercel.app/api/ring/token
 * 
 * For this doorbell helper app, we use direct access tokens (not OAuth flow),
 * so this endpoint returns a 501 to indicate we don't support the OAuth exchange.
 * 
 * If you want to implement full OAuth flow, you would:
 * 1. Create /api/ring/link for account linking
 * 2. Implement token exchange logic here
 * 3. Store refresh tokens in the database
 * 
 * Current implementation: Use RING_REFRESH_TOKEN directly from environment
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    // Log the request for debugging (but don't log secrets)
    console.log('[RING TOKEN] Token exchange request received', {
      hasCode: !!body.code,
      hasGrantType: !!body.grant_type,
      hasRedirectUri: !!body.redirect_uri,
    })
    
    // This app uses direct refresh token flow, not OAuth authorization code flow
    // Return 501 to indicate this endpoint is not implemented
    return NextResponse.json(
      {
        error: 'not_implemented',
        message: 'This app uses direct refresh token flow. Set RING_REFRESH_TOKEN in environment variables instead of OAuth.',
      },
      { status: 501 }
    )
  } catch (e) {
    console.error('[RING TOKEN] Error processing request', e)
    return NextResponse.json(
      { error: 'invalid_request', message: 'Invalid request body' },
      { status: 400 }
    )
  }
}
