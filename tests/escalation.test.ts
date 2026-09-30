import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import os from 'os'
import path from 'path'
import fs from 'fs'

let S: typeof import('../lib/doorbell/store')
let a: string, b: string

beforeAll(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'doorbell-'))
  process.env.RESIDENT_TZ = 'Asia/Kolkata'
  S = await import('../lib/doorbell/store')
  a = S.addHelper('Mom', '+919812345671', '👩').id
  b = S.addHelper('Brother', '+919812345672', '👨').id
  S.setConsent(a, 'approved')
  S.setConsent(b, 'approved')
  S.setTimeoutSec(30)
})
beforeEach(() => { S.resetAll() })

const press = () => S.ingestEvent({ event_type: 'button_press', device_id: 'dev1' })!

describe('system readiness', () => {
  it('is ready with real approved helpers', () => expect(S.systemReady()).toBe(true))
})

describe('escalation', () => {
  it('opens a case for button_press and ignores motion by default', () => {
    expect(S.ingestEvent({ event_type: 'motion_detected', device_id: 'dev1' })).toBeNull()
    expect(press().status).toBe('waiting')
  })
  it('escalates to the next helper after the timeout, then gives up', () => {
    const c = press()
    S.tick(c.deadlineAt + 1)
    expect(c.helperIndex).toBe(1)
    expect(c.status).toBe('waiting')
    S.tick(c.deadlineAt + 1)
    expect(c.status).toBe('no_response')
  })
  it('merges a second press into the open case', () => {
    const c = press()
    expect(press().id).toBe(c.id)
  })
})

describe('who may answer', () => {
  it('rejects helpers who are not in the chain or not approved', () => {
    const c = press()
    expect(S.answerCase(c.id, 'h_intruder', 'safe', 'known')).toMatchObject({ ok: false, status: 403 })
    const pending = S.addHelper('New', '+919812345673', '🙂').id
    expect(S.answerCase(c.id, pending, 'safe', 'known')).toMatchObject({ ok: false, status: 403 })
  })
  it('does not let the second helper jump the queue', () => {
    const c = press()
    expect(S.answerCase(c.id, b, 'safe', 'known')).toMatchObject({ ok: false, status: 409 })
    expect(S.answerCase(c.id, a, 'safe', 'known')).toMatchObject({ ok: true })
  })
})

describe('SOS', () => {
  it('is not acknowledged until a helper really sees it', () => {
    const c = S.raiseSos()
    expect(c.ackedAt).toBeUndefined()
    expect(S.ackCase(c.id, 'h_intruder')).toMatchObject({ ok: false })
    expect(S.ackCase(c.id, a)).toMatchObject({ ok: true })
    expect(c.ackedBy).toBe(a)
  })
})

describe('night lock uses the resident clock', () => {
  it('blocks "yes, open" during quiet hours', () => {
    S.setQuiet({ enabled: true, startHour: 0, endHour: 23 }) // effectively always on
    const c = press()
    S.answerCase(c.id, a, 'safe', 'known')
    S.confirmCase(c.id, true)
    expect(c.confirmedAt).toBeUndefined()
    expect(c.declinedAt).toBeDefined()
    S.setQuiet({ enabled: false, startHour: 22, endHour: 6 })
  })
})

describe('device health', () => {
  it('reports offline so the resident screen cannot say All quiet', () => {
    S.setDeviceOnline('dev1', false, 'test')
    expect(S.getState('resident').offline).toBe(true)
    S.setDeviceOnline('dev1', true, 'test')
    expect(S.getState('resident').offline).toBe(false)
  })
})

describe('what each screen may see', () => {
  it('gives the resident phone numbers but no audit log, and helpers no phone numbers', () => {
    const c = press()
    const r = S.getState('resident')
    expect(r.helpers[0].phone).toBeDefined()
    expect(r.current?.log).toEqual([])
    const h = S.getState('helper', a)
    expect(h.helpers[0].phone).toBeUndefined()
    expect(h.current?.id).toBe(c.id)
  })
})
