import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail, parse } from '@/lib/guard'
import { getDb } from '@/lib/db/client'
import { getConnectionForHousehold, ringConfiguredForHousehold } from '@/lib/ring/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res
  const householdId = a.session!.householdId

  let connection: any
  let configured: boolean
  try {
    connection = await getConnectionForHousehold(householdId)
    configured = await ringConfiguredForHousehold(householdId)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[HOUSEHOLD RING GET]', e)
    return fail(`Failed to load Ring connection status: ${msg}`, 503)
  }

  return NextResponse.json({
    ok: true,
    configured,
    connection: connection
      ? {
          id:             connection.id,
          ringAccountId:  connection.ringAccountId,
          status:         connection.status,
          linkedByUserId: connection.linkedByUserId,
          expiresAt:      connection.expiresAt,
        }
      : null,
  })
}

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('disconnect') }),
  z.object({ action: z.literal('revoke') }),
])

export async function POST(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res
  const householdId = a.session!.householdId

  const p = await parse(req, Body)
  if (p.ok === false) return p.res

  let db
  try {
    db = getDb()
  } catch (e) {
    console.error('[HOUSEHOLD RING POST] Failed to get database connection', e)
    return fail('Database is unavailable. Please try again shortly.', 503)
  }

  let connection: any
  try {
    connection = await db.ringConnection.findFirst({
      where: { householdId, status: 'linked' },
    })
  } catch (e) {
    console.error('[HOUSEHOLD RING POST] Failed to look up Ring connection', e)
    return fail('Unable to load Ring connection. Please try again.', 503)
  }

  if (!connection) {
    return fail('No active Ring connection found. Please link your Ring account first.', 404)
  }

  switch (p.data.action) {
    case 'disconnect': {
      try {
        await db.ringConnection.update({
          where: { id: connection.id },
          data:  { status: 'revoked' },
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error('[HOUSEHOLD RING disconnect]', e)
        return fail(`Failed to disconnect Ring account: ${msg}`, 503)
      }
      return NextResponse.json({ ok: true })
    }

    case 'revoke': {
      const clientId  = process.env.RING_CLIENT_ID
      // Revoke must go to the OAuth server, NOT the Ring API base
      const oauthBase = (process.env.RING_TOKEN_URL ?? 'https://oauth.ring.com/oauth/token')
        .replace(/\/token$/, '')   // strip /token → gives us https://oauth.ring.com/oauth
      if (!clientId) {
        console.error('[HOUSEHOLD RING revoke] RING_CLIENT_ID is not set — skipping Ring-side revoke')
      } else {
        try {
          const revokeRes = await fetch(`${oauthBase}/revoke`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body:    new URLSearchParams({ client_id: clientId }),
            signal:  AbortSignal.timeout(10_000),
          })
          if (!revokeRes.ok) {
            console.error('[HOUSEHOLD RING revoke] Ring OAuth revoke returned', revokeRes.status, await revokeRes.text().catch(() => ''))
          }
        } catch (e) {
          // Log but continue — local revoke must still proceed so the user isn't stuck
          console.error('[HOUSEHOLD RING revoke] Ring OAuth revoke request failed (continuing with local revoke)', e)
        }
      }

      try {
        await db.ringConnection.update({
          where: { id: connection.id },
          data:  { status: 'revoked' },
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error('[HOUSEHOLD RING revoke] Failed to update local connection status', e)
        return fail(`Failed to revoke Ring connection locally: ${msg}`, 503)
      }
      return NextResponse.json({ ok: true })
    }
  }
}
