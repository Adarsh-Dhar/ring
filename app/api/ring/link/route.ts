import { NextRequest, NextResponse } from 'next/server'
import { authorize } from '@/lib/guard'
import { getDb } from '@/lib/db/client'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Ring Partner API Account-Link Callback (GET)
 *
 * Ring redirects the user here after they authorise our app.
 * Query parameters: nonce, time, ring_account_id, signature.
 *
 * Ordering matters for correctness:
 *   1. Validate HMAC signature and timestamp  — rejects forgeries and replays
 *   2. Check guardian session                 — redirect to login if missing
 *      (nonce NOT consumed yet, so the user can log in and return)
 *   3. Consume nonce                          — single-use, now that we know
 *      the session is valid and won't need a re-entry
 *   4. Look up the unclaimed connection
 *   5. Bind it to the guardian's household
 *
 * Step 2 deliberately comes before step 3.  If the user isn't logged in they
 * get redirected to /login?next=<this URL>.  When they come back the HMAC and
 * timestamp are still valid and the nonce hasn't been consumed, so the flow
 * completes on re-entry.  The 5-minute timestamp window gives enough time for
 * a login round-trip; if it has expired the user just retriggers the Ring
 * OAuth flow from /setup.
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

  // ── 1a. HMAC key must be set ──────────────────────────────────────────────
  const hmacKey = process.env.RING_HMAC_KEY
  if (!hmacKey) {
    console.error('[RING LINK] RING_HMAC_KEY not set – rejecting callback')
    return redirect(request, '/setup?error=server_misconfigured')
  }

  // ── 1b. Verify signature (constant-time) ─────────────────────────────────
  const expectedSig = crypto
    .createHmac('sha256', hmacKey)
    .update(`${nonce}:${time}:${ringAccountId}`)
    .digest('hex')

  const sigBuf = Buffer.from(signature,   'hex') as unknown as Uint8Array
  const expBuf = Buffer.from(expectedSig, 'hex') as unknown as Uint8Array

  const validSig =
    sigBuf.length > 0 &&
    sigBuf.length === expBuf.length &&
    crypto.timingSafeEqual(sigBuf, expBuf)

  if (!validSig) {
    console.error('[RING LINK] Invalid HMAC signature')
    return redirect(request, '/setup?error=invalid_signature')
  }

  // ── 1c. Timestamp window (± 5 minutes) ───────────────────────────────────
  const timeNum = parseInt(time, 10)
  if (!Number.isFinite(timeNum) || Math.abs(Math.floor(Date.now() / 1000) - timeNum) > 300) {
    console.error('[RING LINK] Callback outside valid time window')
    return redirect(request, '/setup?error=expired')
  }

  // ── 2. Check guardian session BEFORE consuming the nonce ─────────────────
  // If the user isn't signed in we redirect them to login carrying this full
  // URL as `next`.  When they return all query params are intact and the nonce
  // has not been used, so the flow can complete on re-entry.
  const a = await authorize(request, 'guardian')
  if (a.ok === false) {
    const returnUrl = encodeURIComponent(request.url)
    return NextResponse.redirect(new URL(`/login?next=${returnUrl}`, request.url))
  }

  const session = a.session!

  // ── 3. Consume nonce (single-use) ────────────────────────────────────────
  // Only reached when we have a verified HMAC AND a valid guardian session,
  // so a rogue caller who doesn't have a session can't exhaust nonces.
  const db = getDb()
  try {
    await db.ringNonce.create({ data: { nonce } })
  } catch {
    // Unique constraint → nonce already consumed
    console.error('[RING LINK] Nonce already consumed', nonce)
    return redirect(request, '/setup?error=replay')
  }

  // Prune nonces older than 10 minutes (fire-and-forget)
  db.ringNonce.deleteMany({
    where: { usedAt: { lt: new Date(Date.now() - 10 * 60 * 1000) } },
  }).catch(() => {})

  // ── 4. Look up the unclaimed connection ───────────────────────────────────
  const connection = await db.ringConnection.findUnique({ where: { ringAccountId } })

  if (!connection) {
    console.error('[RING LINK] No connection record for account', ringAccountId)
    return redirect(request, '/setup?error=connection_not_found')
  }

  if (connection.status !== 'unclaimed') {
    if (connection.householdId === session.householdId) {
      // Idempotent – this guardian already linked it
      return redirect(request, '/setup?ring_linked=true')
    }
    console.error('[RING LINK] Connection already claimed by another household', ringAccountId)
    return redirect(request, '/setup?error=connection_already_claimed')
  }

  // ── 5. Bind the connection to the guardian's household ────────────────────
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
