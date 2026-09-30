import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { listDemoClips } from '@/lib/demo'
import { ingestEvent, setOffline, setTimeoutSec, resetAll, getState } from '@/lib/doorbell/store'
import { authorize, fail, parse } from '@/lib/guard'
import { IS_PROD } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * The simulator can switch the real alert pipeline OFF ("offline") and wipe cases.
 * So it is OPT-IN (ENABLE_SIM=1), admin-only, and can never run in production.
 */
const simDisabled = () => process.env.ENABLE_SIM !== '1' || IS_PROD

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('trigger'), eventType: z.string().max(40).default('button_press'), clip: z.string().max(200).nullable().optional() }),
  z.object({ action: z.literal('offline'), value: z.boolean() }),
  z.object({ action: z.literal('timeout'), value: z.number().finite() }),
  z.object({ action: z.literal('reset') }),
])

export async function GET(req: NextRequest) {
  if (simDisabled()) return fail('disabled', 404)
  const a = authorize(req, 'admin')
  if (!a.ok) return a.res
  const s = getState()
  return NextResponse.json({ clips: listDemoClips().map((c) => c.file).sort(), offline: s.offline, timeoutSec: s.timeoutSec })
}

export async function POST(req: NextRequest) {
  if (simDisabled()) return fail('disabled', 404)
  const a = authorize(req, 'admin')
  if (!a.ok) return a.res
  const p = await parse(req, Body)
  if (!p.ok) return p.res
  const body = p.data
  switch (body.action) {
    case 'trigger': {
      const ts = Date.now()
      const id = `sim-front-door_${body.eventType}_${ts}`
      const c = ingestEvent({
        event_id: id,
        event_type: body.eventType,
        device_id: 'sim-front-door',
        raw: { meta: { version: '1.1', request_id: `sim_${ts}` }, data: { id, type: body.eventType, attributes: { source: 'sim-front-door', source_type: 'devices', timestamp: ts, demo_clip: body.clip ?? null } } },
      })
      return NextResponse.json({ ok: true, caseId: c?.id ?? null })
    }
    case 'offline':
      setOffline(body.value)
      return NextResponse.json({ ok: true })
    case 'timeout':
      setTimeoutSec(body.value)
      return NextResponse.json({ ok: true })
    case 'reset':
      resetAll()
      return NextResponse.json({ ok: true })
  }
}
