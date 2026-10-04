import { NextRequest, NextResponse } from 'next/server'
import { authorize, fail } from '@/lib/guard'
import { findActiveLink, revokeActiveLinks, createLink } from '@/lib/db/visit-requests'
import { getHousehold } from '@/lib/db/households'
import { notifyVisitor, msgs, firstName } from '@/lib/visitor-notify'
import { newToken, hashToken } from '@/lib/visit-tokens'
import { cancelPendingRegistrations } from '@/lib/doorbell/regular'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function notifyCancelled(householdId: string, cancelled: any[]) {
  if (!cancelled.length) return
  try {
    const hh  = await getHousehold(householdId)
    const who = firstName(hh?.residentName)
    for (const r of cancelled) {
      notifyVisitor(r, msgs.cancelled(who)).catch(e =>
        console.error('[VISIT LINK] Failed to notify cancelled visitor', e)
      )
    }
  } catch (e) {
    console.error('[VISIT LINK] Failed to send cancellation notifications', e)
  }
}

/** GET — is a visit link active? */
export async function GET(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res

  let l: any
  try {
    l = await findActiveLink(a.session.householdId)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[VISIT LINK GET]', e)
    return fail(`Failed to load visit link status: ${msg}`, 503)
  }

  return NextResponse.json({
    active:    !!l,
    createdAt: l?.createdAt.getTime() ?? null,
  })
}

/** POST — create a new link (rotates any existing one; returns the raw token once). */
export async function POST(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res

  const hid = a.session.householdId

  let cancelled: any[]
  try {
    await cancelPendingRegistrations(hid)
    cancelled = await revokeActiveLinks(hid)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[VISIT LINK POST] Failed to revoke existing links', e)
    return fail(`Failed to rotate visit link: ${msg}`, 503)
  }

  notifyCancelled(hid, cancelled)

  const token = newToken()
  try {
    await createLink(hid, a.session.userId, hashToken(token))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[VISIT LINK POST] Failed to create new link', e)
    return fail(`Failed to create visit link: ${msg}`, 503)
  }

  const appUrl = (process.env.APP_URL ?? '').replace(/\/$/, '')
  if (!appUrl) {
    console.warn('[VISIT LINK POST] APP_URL env var is not set — visit link URL will be relative')
  }

  return NextResponse.json({ url: `${appUrl}/visit/${token}` })
}

/** DELETE — revoke without creating a new one. */
export async function DELETE(req: NextRequest) {
  const a = await authorize(req, 'guardian')
  if (a.ok === false) return a.res

  const hid = a.session.householdId

  let cancelled: any[]
  try {
    await cancelPendingRegistrations(hid)
    cancelled = await revokeActiveLinks(hid)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[VISIT LINK DELETE]', e)
    return fail(`Failed to revoke visit link: ${msg}`, 503)
  }

  notifyCancelled(hid, cancelled)
  return NextResponse.json({ ok: true })
}
