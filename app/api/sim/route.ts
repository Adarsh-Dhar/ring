import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { listDemoClips } from '@/lib/demo'
import { setOffline, setTimeoutSec, resetAll, getState } from '@/lib/doorbell/store'
import { RESIDENT_TZ } from '@/lib/doorbell/config'
import { authorize, fail, parse } from '@/lib/guard'
import { IS_PROD } from '@/lib/auth'
import { buildWebhook, postWebhook, type SigMode } from '@/lib/sim/webhook'
import { getOutbox, clearOutbox } from '@/lib/sim/outbox'
import { advanceClock, clockOffset, now as clockNow } from '@/lib/clock'
import { zonedHourOnSameDay } from '@/lib/time'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Opt-in (ENABLE_SIM=1), admin-only, never in production. */
const simDisabled = () => process.env.ENABLE_SIM !== '1' || IS_PROD
const FAKE = process.env.FAKE_RING_URL            // e.g. http://localhost:4010. Unset = deliver directly from this route.
const DEVICE = 'fake-doorbell-001'

const Mode = z.enum(['normal', 'duplicate', 'late', 'badsig', 'nosig'])
const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('trigger'), eventType: z.string().max(40).default('button_press'), clip: z.string().max(200).nullable().optional(), recurringId: z.string().max(80).nullable().optional(), mode: Mode.default('normal'), delayMs: z.number().int().min(0).max(60_000).default(0) }),
  z.object({ action: z.literal('device'), online: z.boolean() }),
  z.object({ action: z.literal('chaos'), dropPct: z.number().min(0).max(100).default(0), duplicatePct: z.number().min(0).max(100).default(0), lateMs: z.number().min(0).max(60_000).default(0), badSigPct: z.number().min(0).max(100).default(0), appDownPct: z.number().min(0).max(100).default(0) }),
  z.object({ action: z.literal('clock'), op: z.enum(['advance', 'to', 'reset']), ms: z.number().int().min(0).max(30 * 86_400_000).optional(), hour: z.number().int().min(0).max(23).optional(), minute: z.number().int().min(0).max(59).default(0) }),
  z.object({ action: z.literal('swallow'), value: z.boolean() }),     // Ring never delivers anything (the old "offline" switch)
  z.object({ action: z.literal('timeout'), value: z.number().finite() }),
  z.object({ action: z.literal('clearOutbox') }),
  z.object({ action: z.literal('reset') }),
])

const fakeCall = async (path: string, body?: unknown) => {
  const r = await fetch(`${FAKE}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(4000) })
  return r.json()
}

/** Direct mode: sign and POST a webhook to our OWN /api/webhook, so signature, schema, account filter and dedupe all run. */
async function sendDirect(origin: string, type: string, extra: Record<string, unknown>, mode: z.infer<typeof Mode>, delayMs: number) {
  const { raw, requestId } = buildWebhook({ type, deviceId: DEVICE, accountId: process.env.RING_ACCOUNT_ID, extra })
  const sig: SigMode = mode === 'badsig' ? 'bad' : mode === 'nosig' ? 'missing' : 'valid'
  const url = `${origin}/api/webhook`, key = process.env.RING_HMAC_KEY
  const go = async () => { const a = await postWebhook(url, raw, key, sig); if (mode === 'duplicate') await postWebhook(url, raw, key, sig); return a }
  const wait = delayMs + (mode === 'late' ? 20_000 : 0)
  if (wait > 0) { setTimeout(() => void go(), wait); return { scheduledInMs: wait } }
  const r = await go()
  return { webhookStatus: r.status, webhookBody: r.body.slice(0, 200), requestId }
}

export async function GET(req: NextRequest) {
  if (simDisabled()) return fail('disabled', 404)
  const a = authorize(req, 'admin'); if (!a.ok) return a.res
  const s = getState()
  let fakeRing: unknown = null
  if (FAKE) fakeRing = await fakeCall('/__control/state').catch(() => ({ error: 'fake-ring is not running (npm run sim:ring)' }))
  return NextResponse.json({ clips: listDemoClips().map((c) => c.file).sort(), offline: s.offline, timeoutSec: s.timeoutSec, recurring: s.recurring, outbox: getOutbox().slice(0, 30), clockOffsetMs: clockOffset(), simNow: clockNow(), mode: FAKE ? 'fake-ring' : 'direct', fakeRing })
}

export async function POST(req: NextRequest) {
  if (simDisabled()) return fail('disabled', 404)
  const a = authorize(req, 'admin'); if (!a.ok) return a.res
  const p = await parse(req, Body); if (!p.ok) return p.res
  const b = p.data
  try {
    switch (b.action) {
      case 'trigger': {
        const extra = { ...(b.clip ? { demo_clip: b.clip } : {}), ...(b.recurringId ? { demo_recurring_id: b.recurringId } : {}) }
        if (FAKE) return NextResponse.json(await fakeCall('/__control/event', { type: b.eventType, deviceId: DEVICE, clip: b.clip, recurringId: b.recurringId, mode: b.mode, delayMs: b.delayMs }))
        return NextResponse.json({ ok: true, ...(await sendDirect(req.nextUrl.origin, b.eventType, extra, b.mode, b.delayMs)) })
      }
      case 'device': {
        if (FAKE) return NextResponse.json(await fakeCall('/__control/device', { deviceId: DEVICE, online: b.online }))
        return NextResponse.json({ ok: true, ...(await sendDirect(req.nextUrl.origin, b.online ? 'device_online' : 'device_offline', {}, 'normal', 0)) })
      }
      case 'chaos': {
        if (!FAKE) return fail('Chaos needs the fake Ring server (set FAKE_RING_URL, run npm run sim:ring)', 409)
        const { action, ...c } = b; void action
        return NextResponse.json(await fakeCall('/__control/chaos', c))
      }
      case 'clock':
        if (b.op === 'advance') advanceClock(b.ms ?? 0)
        else if (b.op === 'reset') advanceClock(-clockOffset())
        else if (b.hour !== undefined) {
          const n = clockNow(); let t = zonedHourOnSameDay(n, RESIDENT_TZ, b.hour) + b.minute * 60_000
          if (t <= n) t += 86_400_000
          advanceClock(t - n)
        }
        return NextResponse.json({ ok: true, clockOffsetMs: clockOffset() })
      case 'swallow': setOffline(b.value); return NextResponse.json({ ok: true })
      case 'timeout': setTimeoutSec(b.value); return NextResponse.json({ ok: true })
      case 'clearOutbox': clearOutbox(); return NextResponse.json({ ok: true })
      case 'reset': resetAll(); clearOutbox(); return NextResponse.json({ ok: true })
    }
  } catch (e) { return fail(e instanceof Error ? e.message : 'sim failed', 502) }
}
