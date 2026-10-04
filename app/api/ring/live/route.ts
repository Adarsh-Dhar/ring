import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorize, fail, parse } from '@/lib/guard'
import { caseDevice, isCaseOpenFor, logView } from '@/lib/doorbell/store'
import { startWhep, stopWhep, getConnectionForHousehold, ringConfiguredForHousehold } from '@/lib/ring/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Live view through OUR server so the Ring access token never reaches a browser.
 * The browser sends its WebRTC SDP offer here; we forward it to Ring (WHEP) and return the SDP answer.
 * Video flows directly between Ring and the helper's browser.
 */
export async function POST(req: NextRequest) {
  const a = await authorize(req, 'helper')
  if (a.ok === false) return a.res

  const householdId  = a.session!.householdId
  const membershipId = a.session!.membershipId!
  const caseId       = req.nextUrl.searchParams.get('caseId') || ''

  if (!caseId) {
    return fail('caseId query parameter is required.', 400)
  }

  let configured: boolean
  try {
    configured = await ringConfiguredForHousehold(householdId)
  } catch (e) {
    console.error('[RING LIVE POST] Failed to check Ring configuration', e)
    return fail('Unable to verify Ring connection. Please try again.', 503)
  }
  if (!configured) {
    return fail('Ring is not connected to this household. Please link your Ring account in settings.', 503)
  }

  let caseOpen: boolean
  try {
    caseOpen = await isCaseOpenFor(householdId, caseId, membershipId)
  } catch (e) {
    console.error('[RING LIVE POST] Failed to check case access', e)
    return fail('Unable to verify case access. Please try again.', 503)
  }
  if (!caseOpen) {
    return fail('Live video is not available for this case. The case may have expired or you may not have access.', 403)
  }

  const device = caseDevice(householdId, caseId)
  if (!device) {
    return fail('No Ring device is associated with this doorbell event.', 404)
  }
  if (device.startsWith('sim-')) {
    return fail('Live video is not available for simulated doorbell events.', 404)
  }

  let connection: any
  try {
    connection = await getConnectionForHousehold(householdId)
  } catch (e) {
    console.error('[RING LIVE POST] Failed to load Ring connection', e)
    return fail('Unable to load Ring connection. Please try again.', 503)
  }
  if (!connection) {
    return fail('Ring connection not found. Please link your Ring account in settings.', 404)
  }

  const offer = await req.text()
  if (!offer.startsWith('v=0')) {
    return fail('Invalid SDP offer: must start with "v=0".', 400)
  }
  if (offer.length > 20_000) {
    return fail('SDP offer is too large (max 20 KB).', 400)
  }

  try {
    const { answer, sessionId } = await startWhep(connection.id, device, offer)
    await logView(householdId, caseId, membershipId, 'opened live video').catch(e =>
      console.error('[RING LIVE POST] Failed to log view', e)
    )
    return new Response(answer, {
      status:  201,
      headers: {
        'Content-Type': 'application/sdp',
        'X-Session-Id': sessionId,
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[RING LIVE POST] Failed to start WHEP session', e)
    return fail(`Could not start live video: ${msg}`, 502)
  }
}

export async function DELETE(req: NextRequest) {
  const a = await authorize(req, 'helper')
  if (a.ok === false) return a.res

  const householdId  = a.session!.householdId
  const membershipId = a.session!.membershipId!

  const p = await parse(req, z.object({
    caseId:    z.string().min(1).max(80),
    sessionId: z.string().min(1).max(200),
  }))
  if (p.ok === false) return p.res

  let caseOpen: boolean
  try {
    caseOpen = await isCaseOpenFor(householdId, p.data.caseId, membershipId)
  } catch (e) {
    console.error('[RING LIVE DELETE] Failed to check case access', e)
    return fail('Unable to verify case access. Please try again.', 503)
  }
  if (!caseOpen) {
    return fail('You do not have access to this case.', 403)
  }

  const device = caseDevice(householdId, p.data.caseId)

  let connection: any
  try {
    connection = await getConnectionForHousehold(householdId)
  } catch (e) {
    console.error('[RING LIVE DELETE] Failed to load Ring connection', e)
    // Non-fatal for DELETE — just log and return ok
  }

  if (device && connection) {
    try {
      await stopWhep(connection.id, device, p.data.sessionId)
    } catch (e) {
      // Non-fatal — browser already closed the stream, best-effort stop
      console.error('[RING LIVE DELETE] Failed to stop WHEP session', e)
    }
  }

  return NextResponse.json({ ok: true })
}
