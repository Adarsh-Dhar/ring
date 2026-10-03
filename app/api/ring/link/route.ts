import { NextRequest, NextResponse } from 'next/server'
import { authorize } from '@/lib/guard'
import { getDb } from '@/lib/db/client'
import { IS_PROD } from '@/lib/auth'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Ring Partner API Account-Link Callback (GET)
 *
 * Ring redirects the user here after they authorise our app.
 * Ring appends the following query parameters:
 *   nonce          – random value we generated and sent to Ring when starting the flow
 *   time           – Unix timestamp (seconds) Ring appended
 *   ring_account_id – the Ring account that just authorised
 *   signature      – HMAC-SHA256 over `nonce + ":" + time + ":" + ring_account_id`
 *                    keyed with RING_HMAC_KEY
 *
 * Security properties enforced here:
 *   1. Signature is REQUIRED – no key → reject (prevents open redirect / hijack).
 *   2. Timestamp must be within 5 minutes (replay window).
 *   3. Nonce is single-use (stored in RingNonce table).
 *   4. Caller must have a valid, full guardian session before we bind anything.
 *   5. Guardian-only – helpers cannot link a Ring connection.
 *   6. ring_account_id comes from Ring (after HMAC verification), never trusted raw.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams

  const nonce         = sp.get('nonce')
  const time          = sp.get('time')
  const ringAccountId = sp.get('ring_account_id')
  const signature     = sp.get('signature')

  if (!nonce || !time || !ringAccountId || !signature) {
    return redirect(request, '/setup?error=missing_params')
  }

  // ── 1. HMAC signature verification (always required) ──────────────────────
  const hmacKey = process.env.RING_HMAC_KEY
  if (!hmacKey) {
    // A missing key means the server is misconfigured – refuse every request.
    console.error('[RING LINK] RING_HMAC_KEY is not set – refusing link callback')
    return redirect(request, '/setup?error=server_misconfigured')
  }

  const expectedSig = crypto
    .createHmac('sha256', hmacKey)
    .update(`${nonce}:${time}:${ringAccountId}`)
    .digest('hex')

  const sigBuf = Buffer.from(signature,    'hex') as unknown as Uint8Array
  const expBuf = Buffer.from(expectedSig,  'hex') as unknown as Uint8Array

  const validSig =
    sigBuf.length === expBuf.length &&
    sigBuf.length > 0 &&
    crypto.timingSafeEqual(sigBuf, expBuf)

  if (!validSig) {
    console.error('[RING LINK] Invalid HMAC signature')
    return redirect(request, '/setup?error=invalid_signature')
  }

  // ── 2. Timestamp window (± 5 minutes) ────────────────────────────────────
  const timeNum = parseInt(time, 10)
  if (!Number.isFinite(timeNum) || Math.abs(Math.floor(Date.now() / 1000) - timeNum) > 300) {
    console.error('[RING LINK] Callback outside valid time window')
    return redirect(request, '/setup?error=expired')
  }

  // ── 3. Nonce single-use check ─────────────────────────────────────────────
  const db = getDb()
  try {
    await db.ringNonce.create({ data: { nonce } })
  } catch {
    // Unique constraint violation → nonce already used
    console.error('[RING LINK] Nonce already consumed', nonce)
    return redirect(request, '/setup?error=replay')
  }

  // Prune nonces older than 10 minutes (background, don't await)
  db.ringNonce.deleteMany({
    where: { usedAt: { lt: new Date(Date.now() - 10 * 60 * 1000) } },
  }).catch(() => {})

  // ── 4 & 5. Guardian-only session ─────────────────────────────────────────
  const a = await authorize(request, 'guardian')
  if (a.ok === false) {
    // Not signed in or wrong role – redirect to login with return URL
    if (!IS_PROD) {
      console.warn('[RING LINK] Unauthenticated or non-guardian user')
    }
    const returnUrl = encodeURIComponent(request.url)
    return NextResponse.redirect(new URL(`/login?next=${returnUrl}`, request.url))
  }

  const session = a.session!

  // ── 6. Look up the unclaimed connection ───────────────────────────────────
  // ring_account_id is trusted here because it was covered by the HMAC above.
  const connection = await db.ringConnection.findUnique({
    where: { ringAccountId },
  })

  if (!connection) {
    console.error('[RING LINK] No connection record for account', ringAccountId)
    return redirect(request, '/setup?error=connection_not_found')
  }

  if (connection.status !== 'unclaimed') {
    // Already linked or revoked
    if (connection.householdId === session.householdId) {
      // This guardian's household already owns it – idempotent success
      return redirect(request, '/setup?ring_linked=true')
    }
    console.error('[RING LINK] Connection already claimed by another household', ringAccountId)
    return redirect(request, '/setup?error=connection_already_claimed')
  }

  // ── 7. Bind the connection to the guardian's household ────────────────────
  await db.ringConnection.update({
    where: { id: connection.id },
    data: {
      householdId:    session.householdId,
      status:         'linked',
      linkedByUserId: session.userId,
    },
  })

  console.log('[RING LINK] Connection linked', {
    connectionId: connection.id,
    householdId:  session.householdId,
    userId:       session.userId,
  })

  return redirect(request, '/setup?ring_linked=true')
}

function redirect(req: NextRequest, path: string) {
  return NextResponse.redirect(new URL(path, req.url))
}
