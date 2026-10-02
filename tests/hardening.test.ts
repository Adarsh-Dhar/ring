import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { NextRequest } from 'next/server'

let S: typeof import('../lib/doorbell/store')
let N: typeof import('../lib/doorbell/notify')
let G: typeof import('../lib/guard')
let a: string, b: string
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'doorbell-hard-'))

// Counts real Twilio calls without touching the network.
let smsCalls: string[] = []
const fakeFetch = vi.fn(async (_url: any, init: any) => {
  smsCalls.push(String(init?.body))
  return new Response('{}', { status: 201 })
})

beforeAll(async () => {
  process.env.DATA_DIR = DIR
  process.env.RESIDENT_TZ = 'Asia/Kolkata'
  process.env.CHECKIN_HOUR = '10'
  process.env.CHECKIN_GRACE_MIN = '60'
  process.env.ADMIN_PIN = '4821'
  S = await import('../lib/doorbell/store')
  N = await import('../lib/doorbell/notify')
  G = await import('../lib/guard')
  a = S.addHelper('Mom', '+919800000011', '👩').id
  b = S.addHelper('Brother', '+919800000022', '👨').id
  S.setConsent(a, 'approved')
  S.setConsent(b, 'approved')
  S.setTimeoutSec(30)
  S.checkIn() // today's real check-in is done, so the real clock can't fire a missed-check-in alert mid-suite
})

beforeEach(() => {
  smsCalls = []
  fakeFetch.mockClear()
  vi.stubGlobal('fetch', fakeFetch)
  vi.stubEnv('TWILIO_ACCOUNT_SID', 'ACtest')
  vi.stubEnv('TWILIO_AUTH_TOKEN', 'tok')
  vi.stubEnv('TWILIO_FROM', '+10000000000')
  vi.stubEnv('TWILIO_TEMPLATE_NAME', '')
  S.resetAll()
  N.resetFailures()
  S.resetAlertWarning()
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('SMS never crashes the app', () => {
  it('does not throw when Twilio is not configured outside tests, and counts the failure', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('TWILIO_ACCOUNT_SID', '')
    vi.stubEnv('TWILIO_AUTH_TOKEN', '')
    vi.stubEnv('TWILIO_FROM', '')
    await expect(N.sendSms('+919800000099', 'x')).resolves.toBe(false)
    expect(N.recentFailures().sms).toBe(1)
  })
  it('survives a flood of webhooks with Twilio unconfigured (no unhandled rejection)', async () => {
    const rejections: unknown[] = []
    const onRej = (e: unknown) => rejections.push(e)
    process.on('unhandledRejection', onRej)
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('TWILIO_ACCOUNT_SID', '')
    vi.stubEnv('TWILIO_AUTH_TOKEN', '')
    vi.stubEnv('TWILIO_FROM', '')
    for (let i = 0; i < 20; i++) S.setDeviceOnline('flap-dev', i % 2 === 1, 'test')
    S.ingestEvent({ event_type: 'button_press', device_id: 'dev1' })
    await new Promise((r) => setTimeout(r, 50))
    process.off('unhandledRejection', onRej)
    expect(rejections).toHaveLength(0)
  })
  it('counts a Twilio error response as a failure but does not throw', async () => {
    fakeFetch.mockImplementationOnce(async () => new Response('{"code":572006}', { status: 400 }))
    await expect(N.sendSms('+919800000077', 'x', { urgent: true })).resolves.toBe(false)
    expect(N.recentFailures().sms).toBe(1)
  })
})

describe('SMS limiter and urgent alerts', () => {
  it('limits repeatable texts to one per number per minute', async () => {
    expect(await N.sendSms('+919800000101', 'one')).toBe(true)
    expect(await N.sendSms('+919800000101', 'two')).toBe(false)
    expect(smsCalls).toHaveLength(1)
  })
  it('lets urgent texts through the limiter', async () => {
    await N.sendSms('+919800000102', 'one')
    expect(await N.sendSms('+919800000102', 'sos', { urgent: true })).toBe(true)
    expect(smsCalls).toHaveLength(2)
  })
  it('a flapping doorbell texts each helper once, not on every flip', async () => {
    for (let i = 0; i < 20; i++) S.setDeviceOnline('flap-2', i % 2 === 1, 'test') // 10 offline events
    await new Promise((r) => setTimeout(r, 30))
    expect(smsCalls).toHaveLength(2) // 2 helpers, one text each
  })
  it('SOS still texts everyone right after a flapping burst', async () => {
    for (let i = 0; i < 4; i++) S.setDeviceOnline('flap-3', i % 2 === 1, 'test')
    await new Promise((r) => setTimeout(r, 30))
    smsCalls.length = 0
    S.raiseSos()
    await new Promise((r) => setTimeout(r, 30))
    expect(smsCalls).toHaveLength(2) // both helpers, even though both numbers were just texted
  })
  it('a new visitor case still texts the first helper right after a flapping burst', async () => {
    for (let i = 0; i < 4; i++) S.setDeviceOnline('flap-4', i % 2 === 1, 'test')
    await new Promise((r) => setTimeout(r, 30))
    smsCalls.length = 0
    S.ingestEvent({ event_type: 'button_press', device_id: 'dev9' })
    await new Promise((r) => setTimeout(r, 30))
    expect(smsCalls).toHaveLength(1)
  })
  it('a failed send releases the slot so the next alert can retry', async () => {
    fakeFetch.mockImplementationOnce(async () => new Response('{}', { status: 500 }))
    expect(await N.sendSms('+919800000103', 'a')).toBe(false)
    expect(await N.sendSms('+919800000103', 'b')).toBe(true)
  })
})

describe('alerts are failing notice', () => {
  it('lists approved helpers who have no push on', () => {
    const st = S.alertStatus()
    expect(st.helpersWithoutPush.sort()).toEqual(['Brother', 'Mom'])
    expect(st.degraded).toBe(true)
  })
  it('turns degraded on after repeated push failures and exposes it in health and helper view only', () => {
    S.addSub(a, { endpoint: 'https://push.example/a', keys: { p256dh: 'p', auth: 'a' } })
    S.addSub(b, { endpoint: 'https://push.example/b', keys: { p256dh: 'p', auth: 'a' } })
    expect(S.alertStatus().degraded).toBe(false)
    for (let i = 0; i < 3; i++) N.recordFailure('push')
    expect(S.alertStatus().degraded).toBe(true)
    expect(S.getHealth().alerts.degraded).toBe(true)
    expect(S.getState('helper', a).alerts?.degraded).toBe(true)
    expect(S.getState('resident').alerts).toBeNull() // the resident screen stays calm
    S.removeSub(a, 'https://push.example/a')
    S.removeSub(b, 'https://push.example/b')
  })
})

describe('escalation and answering', () => {
  it('1000 presses make one case', () => {
    const first = S.ingestEvent({ event_type: 'button_press', device_id: 'dev1' })!
    for (let i = 0; i < 999; i++) expect(S.ingestEvent({ event_type: 'button_press', device_id: 'dev1' })!.id).toBe(first.id)
  })
  it('a second helper answering after the first gets 409', () => {
    const c = S.raiseSos()
    const r1 = S.answerCase(c.id, a, 'safe')
    const r2 = S.answerCase(c.id, b, 'not_safe')
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.status).toBe(409)
  })
  it('texts the next helper on escalation even if that number was just texted', async () => {
    const c = S.ingestEvent({ event_type: 'button_press', device_id: 'dev1' })!
    await new Promise((r) => setTimeout(r, 30))
    smsCalls.length = 0
    S.tick(c.deadlineAt + 1)
    await new Promise((r) => setTimeout(r, 30))
    expect(smsCalls.length).toBeGreaterThanOrEqual(1)
  })
})

describe('daily check-in', () => {
  it('alerts once when missed and not again on later ticks', async () => {
    const late = Date.parse('2031-03-05T06:00:00Z') // 11:30 in Kolkata on a day nobody checked in, past 10:00 + 60 min grace
    S.tick(late)
    await new Promise((r) => setTimeout(r, 30))
    const first = smsCalls.length
    expect(first).toBe(2) // both helpers, once
    S.tick(late + 60_000)
    S.tick(late + 5 * 60_000)
    await new Promise((r) => setTimeout(r, 30))
    expect(smsCalls.length).toBe(first)
  })
})

describe('restart in the middle of a case', () => {
  it('brings the open case back with a fresh timer after a restart', async () => {
    const c = S.ingestEvent({ event_type: 'button_press', device_id: 'dev-restart' })!
    await new Promise((r) => setTimeout(r, 450)) // state is written at most every 300 ms
    expect(fs.existsSync(path.join(DIR, 'state.json'))).toBe(true)
    delete (globalThis as any).__doorbell
    vi.resetModules()
    const S2 = await import('../lib/doorbell/store')
    const back = S2.getHistory().cases.find((x) => x.id === c.id)
    expect(back).toBeTruthy()
    expect(back!.status).toBe('waiting')
    expect(back!.log.some((l) => l.msg.includes('Server restarted'))).toBe(true)
    expect(back!.deadlineAt).toBeGreaterThan(Date.now())
  })
})

describe('Ring refresh token', () => {
  it('saves the rotated token and a restart picks it up instead of the dead one from .env', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ring-token-'))
    vi.stubEnv('DATA_DIR', dir)
    vi.stubEnv('RING_REFRESH_TOKEN', 'old-dead-token')
    vi.stubEnv('RING_CLIENT_ID', 'cid')
    vi.stubEnv('RING_CLIENT_SECRET', 'sec')
    vi.resetModules()
    const R1 = await import('../lib/ring/client')
    fakeFetch.mockImplementationOnce(async () =>
      new Response(JSON.stringify({ access_token: 'acc', refresh_token: 'new-token', expires_in: 14400 }), { status: 200 }))
    expect(await R1.forceRefresh()).toBe(true)
    const file = path.join(dir, 'ring-token.json')
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).refreshToken).toBe('new-token')
    expect((fs.statSync(file).mode & 0o777).toString(8)).toBe('600')
    vi.resetModules()
    const R2 = await import('../lib/ring/client')
    expect(R2.loadSavedRefreshToken()).toBe('new-token')
    // The second "process" must refresh with the NEW token.
    let sent = ''
    fakeFetch.mockImplementationOnce(async (_u: any, init: any) => {
      sent = String(init.body)
      return new Response(JSON.stringify({ access_token: 'acc2', refresh_token: 'newer', expires_in: 14400 }), { status: 200 })
    })
    await R2.forceRefresh()
    expect(sent).toContain('refresh_token=new-token')
  })
})

describe('admin PIN lockout', () => {
  const req = (pin: string, ip = '203.0.113.7') =>
    new NextRequest('http://localhost/api/setup', { headers: { 'x-setup-pin': pin, 'x-forwarded-for': ip } })
  beforeEach(() => G.clearPinFailures())

  it('locks out after 5 wrong PINs, even for the right PIN, with 429', () => {
    for (let i = 0; i < 5; i++) {
      const r = G.authorize(req('0000'), 'admin')
      expect(r.ok).toBe(false)
    }
    const locked = G.authorize(req('4821'), 'admin')
    expect(locked.ok).toBe(false)
    if (!locked.ok) expect(locked.res.status).toBe(429)
  })
  it('does not lock other clients, and the right PIN works before lockout', () => {
    for (let i = 0; i < 5; i++) G.authorize(req('0000', '198.51.100.1'), 'admin')
    const other = G.authorize(req('4821', '198.51.100.2'), 'admin')
    expect(other.ok).toBe(true)
  })
  it('lets the lockout expire after 15 minutes', () => {
    const now = Date.now()
    for (let i = 0; i < 5; i++) G.recordPinFailure('x', now)
    expect(G.pinLockedOut('x', now + 1000)).toBe(true)
    expect(G.pinLockedOut('x', now + 16 * 60_000)).toBe(false)
  })
})
