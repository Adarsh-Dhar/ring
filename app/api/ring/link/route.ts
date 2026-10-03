// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/guard'
import { getDb } from '@/lib/db/client'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Ring Partner API Account Link Endpoint
 * The user lands here after authorizing with Ring.
 * We verify the nonce/time parameters and bind the connection to their household.
 *
 * Query params from Ring:
 * - nonce: random string to prevent replay attacks
 * - time: timestamp to prevent replay attacks
 * - ring_account_id: the Ring account ID
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const nonce = searchParams.get('nonce')
  const time = searchParams.get('time')
  const ringAccountId = searchParams.get('ring_account_id')

  console.log('[RING LINK] Account link callback received', {
    hasNonce: !!nonce,
    hasTime: !!time,
    hasRingAccountId: !!ringAccountId,
  })

  if (!nonce || !time || !ringAccountId) {
    return NextResponse.redirect(new URL('/login?error=missing_params', request.url))
  }

  // Verify the HMAC signature if RING_HMAC_KEY is set
  const hmacKey = process.env.RING_HMAC_KEY
  if (hmacKey) {
    const expectedSig = crypto.createHmac('sha256', hmacKey)
      .update(`${nonce}:${time}:${ringAccountId}`)
      .digest('hex')

    const providedSig = searchParams.get('signature')
    if (!providedSig || providedSig !== expectedSig) {
      console.error('[RING LINK] Invalid signature')
      return NextResponse.redirect(new URL('/login?error=invalid_signature', request.url))
    }
  }

  // Check if the time is within a reasonable window (5 minutes)
  const timeNum = parseInt(time, 10)
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - timeNum) > 300) {
    console.error('[RING LINK] Time outside valid window')
    return NextResponse.redirect(new URL('/login?error=expired', request.url))
  }

  // Check if user is logged in
  const session = await getSession(request)
  if (!session) {
    // Redirect to login with a return URL
    const returnUrl = encodeURIComponent(request.url)
    return NextResponse.redirect(new URL(`/login?next=${returnUrl}`, request.url))
  }

  // Find the unclaimed connection
  const db = getDb()
  const connection = await db.ringConnection.findUnique({
    where: { ringAccountId },
  })

  if (!connection) {
    console.error('[RING LINK] Connection not found for account', ringAccountId)
    return NextResponse.redirect(new URL('/setup?error=connection_not_found', request.url))
  }

  if (connection.status !== 'unclaimed') {
    console.error('[RING LINK] Connection already claimed', ringAccountId)
    return NextResponse.redirect(new URL('/setup?error=connection_already_claimed', request.url))
  }

  // Update the connection to link it to the user's household
  await db.ringConnection.update({
    where: { id: connection.id },
    data: {
      householdId: session.householdId,
      status: 'linked',
      linkedByUserId: session.userId,
    },
  })

  console.log('[RING LINK] Connection linked to household', {
    connectionId: connection.id,
    householdId: session.householdId,
    userId: session.userId,
  })

  // Confirm the integration with Ring (if required by Ring's App Integrations)
  // TODO: Add Ring App Integrations confirm endpoint call if needed

  // Redirect to setup page
  return NextResponse.redirect(new URL('/setup?ring_linked=true', request.url))
}
