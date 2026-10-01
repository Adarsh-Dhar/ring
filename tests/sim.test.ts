import { describe, it, expect, beforeAll } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { NextRequest } from 'next/server'
import { buildWebhook, sign } from '../lib/sim/webhook'
import { verifyRingSignature } from '../lib/ring/verify'

const KEY = 'test-hmac-key'
let hook: typeof import('../app/api/webhook/route')
let S: typeof import('../lib/doorbell/store')
let clock: typeof import('../lib/clock')

beforeAll(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'doorbell-sim-'))
  process.env.RING_HMAC_KEY = KEY
  process.env.ENABLE_SIM = '1'
  S = await import('../lib/doorbell/store')
  clock = await import('../lib/clock')
  hook = await import('../app/api/webhook/route')
  const a = S.addHelper('Mom', '+919812345671', '👩').id
  S.setConsent(a, 'approved')
})

const post = (raw: string, sig?: string) =>
  hook.POST(new NextRequest('http://localhost/api/webhook', { method: 'POST', body: raw, headers: sig ? { 'x-signature': sig } : {} }))

describe('simulated webhooks go through the real route', () => {
  it('a signed button_press opens a case', async () => {
    S.resetAll()
    const { raw } = buildWebhook({ type: 'button_press', deviceId: 'fake-doorbell-001' })
    expect(verifyRingSignature(KEY, raw, sign(KEY, raw))).toBe(true)
    const res = await post(raw, sign(KEY, raw))
    expect(res.status).toBe(200)
    expect(S.getState().current?.status).toBe('waiting')
  })
  it('rejects a bad or missing signature', async () => {
    const { raw } = buildWebhook({ type: 'button_press', deviceId: 'fake-doorbell-001' })
    expect((await post(raw, sign('wrong', raw))).status).toBe(401)
    expect((await post(raw)).status).toBe(401)
  })
  it('a duplicate delivery (same request_id) does not alert twice', async () => {
    S.resetAll()
    const { raw } = buildWebhook({ type: 'button_press', deviceId: 'fake-doorbell-001' })
    await post(raw, sign(KEY, raw))
    const again = await (await post(raw, sign(KEY, raw))).json()
    expect(again.status).toBe('already_processed')
  })
  it('device_offline marks the doorbell offline', async () => {
    S.resetAll()
    const { raw } = buildWebhook({ type: 'device_offline', deviceId: 'fake-doorbell-001' })
    await post(raw, sign(KEY, raw))
    expect(S.anyDeviceOffline()).toBe(true)
  })
})

describe('simulated clock', () => {
  it('advancing the clock escalates a waiting case', async () => {
    S.resetAll()
    const { raw } = buildWebhook({ type: 'button_press', deviceId: 'fake-doorbell-001' })
    await post(raw, sign(KEY, raw))
    clock.advanceClock(40_000)
    expect(S.getState().current?.helperIndex).toBeGreaterThanOrEqual(1)
    S.resetAll() // also resets the clock
    expect(clock.clockOffset()).toBe(0)
  })
})
