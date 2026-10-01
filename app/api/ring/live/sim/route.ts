import { NextRequest, NextResponse } from 'next/server'
import { authorize, fail } from '@/lib/guard'
import { caseDevice, isCaseOpenFor, logView } from '@/lib/doorbell/store'
import { startWhep, ringConfigured } from '@/lib/ring/client'
import { IS_PROD } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Simulated live view. Does the REAL server-side steps (auth, case check, token, WHEP session request,
 * audit log, session limit, 1 stream per device) against the fake Ring server, then tells the browser how long the
 * stream may run. The browser plays a local mp4 for that long (see CameraFeed). Dev only.
 */
export async function POST(req: NextRequest) {
  if (process.env.ENABLE_SIM !== '1' || IS_PROD) return fail('disabled', 404)
  const a = authorize(req, 'helper'); if (!a.ok) return a.res
  const helperId = (a.session as { helperId: string }).helperId
  const caseId = req.nextUrl.searchParams.get('caseId') || ''
  if (!isCaseOpenFor(caseId, helperId)) return fail('not allowed', 403)
  const device = caseDevice(caseId)
  if (!device) return fail('No device for this case', 404)
  if (!ringConfigured()) return fail('Ring is not connected', 503)
  try {
    const { sessionId } = await startWhep(device, 'v=0\r\n')
    logView(caseId, helperId, 'opened live video (simulated)')
    return NextResponse.json({ sessionId, maxSeconds: Number(process.env.SIM_STREAM_SECONDS || 30), deviceId: device })
  } catch (e) {
    const m = e instanceof Error ? e.message : ''
    return fail(m.includes('429') ? 'Another live view is already running' : m.includes('409') ? 'The doorbell is offline' : 'Could not start live video', 502)
  }
}
