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
 * Step ordering:
 *   1. Validate HMAC signature and timestamp  — rejects forgeries and replays
 *   2. Check guardian session                 — redirect to login if missing
 *      (nonce NOT consumed yet, so the user can log in and return)
 *   3. Consume nonce                          — single-use
 *   4. Look up the unclaimed connection
 *   5. Bind it to the guardian's household
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams

  const nonce         = sp.get('nonce')
  const time          = sp.get('time')
  const ringAccountId = sp.get('ring_account_id')
  const signature     = sp.get('signature')

  if (!nonce || !time || !ringAccountId || !signature) {
    return redirect(request, '/setup?error=missing_params&error_detail=One+or+more+required+Ring+callback+parameters+are+missing')
  }

  // ── 1a. HMAC key must be set ──────────────────────────────────────────────
  const hmacKey = process.env.RING_HMAC_KEY
  if (!hmacKey) {
    console.error('[RING LINK] RING_HMAC_KEY is not set — cannot verify Ring callback')
    return redirect(request, '/setup?error=server_misconfigured&error_detail=RING_HMAC_KEY+is+not+configured')
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
    console.error('[RING LINK] HMAC signature mismatch — possible forgery or wrong RING_HMAC_KEY')
    return redirect(request, '/setup?error=invalid_signature&error_detail=Ring+callback+signature+is+invalid')
  }

  // ── 1c. Timestamp window (± 5 minutes) ───────────────────────────────────
  const timeNum = parseInt(time, 10)
  if (!Number.isFinite(timeNum) || Math.abs(Math.floor(Date.now() / 1000) - timeNum) > 300) {
    console.error('[RING LINK] Callback timestamp is outside the 5-minute window')
    return redirect(request, '/setup?error=expired&error_detail=Ring+callback+has+expired.+Please+start+the+linking+process+again.')
  }

  // ── 2. Check guardian session BEFORE consuming the nonce ─────────────────
  const a = await authorize(request, 'guardian')
  if (a.ok === false) {
    const returnUrl = encodeURIComponent(request.url)
    return NextResponse.redirect(new URL(`/login?next=${returnUrl}`, request.url))
  }

  const session = a.session!

  // ── 3. Consume nonce (single-use) ────────────────────────────────────────
  let db
  try {
    db = getDb()
  } catch (e) {
    console.error('[RING LINK] Failed to get database connection', e)
    return redirect(request, '/setup?error=server_error&error_detail=Database+is+unavailable')
  }

  try {
    await db.ringNonce.create({ data: { nonce } })
  } catch {
    // Unique constraint violation → nonce already consumed
    console.error('[RING LINK] Nonce already consumed — possible replay attack', nonce)
    return redirect(request, '/setup?error=replay&error_detail=This+Ring+callback+has+already+been+used.+Please+start+the+linking+process+again.')
  }

  // Prune nonces older than 10 minutes (fire-and-forget)
  db.ringNonce.deleteMany({
    where: { usedAt: { lt: new Date(Date.now() - 10 * 60 * 1000) } },
  }).catch(e => console.error('[RING LINK] Failed to prune old nonces', e))

  // ── 4. Look up the unclaimed connection ───────────────────────────────────
  let connection: any
  try {
    connection = await db.ringConnection.findUnique({ where: { ringAccountId } })
  } catch (e) {
    console.error('[RING LINK] Failed to look up Ring connection', e)
    return redirect(request, '/setup?error=server_error&error_detail=Failed+to+look+up+Ring+connection')
  }

  if (!connection) {
    console.error('[RING LINK] No connection record found for Ring account', ringAccountId)
    return redirect(request, '/setup?error=connection_not_found&error_detail=No+pending+Ring+connection+was+found.+The+token+exchange+may+have+failed.')
  }

  if (connection.status !== 'unclaimed') {
    if (connection.householdId === session.householdId) {
      // Idempotent — this guardian already linked it
      return redirect(request, '/setup?ring_linked=true')
    }
    console.error('[RING LINK] Connection already claimed by a different household', ringAccountId)
    return redirect(request, '/setup?error=connection_already_claimed&error_detail=This+Ring+account+is+already+linked+to+a+different+household.')
  }

  // ── 5. Bind the connection to the guardian's household ────────────────────
  try {
    await db.ringConnection.update({
      where: { id: connection.id },
      data:  {
        householdId:    session.householdId,
        status:         'linked',
        linkedByUserId: session.userId,
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[RING LINK] Failed to bind connection to household', e)
    return redirect(request, `/setup?error=server_error&error_detail=${encodeURIComponent(`Failed to save Ring connection: ${msg}`)}`)
  }

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
