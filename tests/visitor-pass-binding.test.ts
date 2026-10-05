import { describe, it, expect } from 'vitest'
import { useVisitorPass, sha256, sameHash, type PassStore, type PassRow } from '@/lib/visitor/binding'

const SECRET = 's'.repeat(64)
const DEV_A  = 'device-aaaaaaaaaaaaaaaa'
const DEV_B  = 'device-bbbbbbbbbbbbbbbb'
const NOW    = new Date('2026-10-05T10:00:00Z')

function fakeStore(over: Partial<PassRow> = {}) {
  const row: PassRow = {
    id: 'p1', householdId: 'h1',
    windowStart: new Date('2026-10-05T09:00:00Z'), windowEnd: new Date('2026-10-05T12:00:00Z'),
    revokedAt: null, boundDeviceHash: null, ...over,
  }
  const events: string[] = []
  const store: PassStore = {
    findBySecretHash: async (h) => (h === sha256(SECRET) ? { ...row } : null),   // returns a copy, like a DB read
    bindIfUnbound: async (_id, dh) => { await Promise.resolve(); if (row.boundDeviceHash) return false; row.boundDeviceHash = dh; return true },
    boundHash: async () => row.boundDeviceHash,
    recordEvent: async (_id, type) => { events.push(type) },
  }
  return { row, events, store }
}

describe('visitor pass device binding', () => {
  it('first use binds the device', async () => {
    const { row, store, events } = fakeStore()
    const r = await useVisitorPass(store, SECRET, DEV_A, NOW)
    expect(r).toMatchObject({ ok: true, firstUse: true, passId: 'p1', householdId: 'h1' })
    expect(row.boundDeviceHash).toBe(sha256(DEV_A))
    expect(events).toEqual(['bound', 'used'])
  })

  it('the same device can use it again', async () => {
    const { store } = fakeStore()
    await useVisitorPass(store, SECRET, DEV_A, NOW)
    expect(await useVisitorPass(store, SECRET, DEV_A, NOW)).toMatchObject({ ok: true, firstUse: false })
  })

  it('a different device is refused with 403 and the binding is unchanged', async () => {
    const { row, store, events } = fakeStore()
    await useVisitorPass(store, SECRET, DEV_A, NOW)
    const r = await useVisitorPass(store, SECRET, DEV_B, NOW)
    expect(r).toEqual({ ok: false, reason: 'wrong_device', status: 403 })
    expect(row.boundDeviceHash).toBe(sha256(DEV_A))
    expect(events).toContain('rejected')
  })

  it('two phones racing for a fresh pass: exactly one wins, the other gets 403', async () => {
    const { row, store } = fakeStore()
    const [a, b] = await Promise.all([useVisitorPass(store, SECRET, DEV_A, NOW), useVisitorPass(store, SECRET, DEV_B, NOW)])
    const results = [a, b]
    expect(results.filter(r => r.ok)).toHaveLength(1)
    const loser = results.find(r => !r.ok)!
    expect(loser).toMatchObject({ ok: false, reason: 'wrong_device', status: 403 })
    expect([sha256(DEV_A), sha256(DEV_B)]).toContain(row.boundDeviceHash)
  })

  it('wrong secret and malformed input look identical (404, no guessing oracle)', async () => {
    const { store } = fakeStore()
    expect(await useVisitorPass(store, 'x'.repeat(64), DEV_A, NOW)).toEqual({ ok: false, reason: 'invalid', status: 404 })
    expect(await useVisitorPass(store, 'short', DEV_A, NOW)).toEqual({ ok: false, reason: 'invalid', status: 404 })
    expect(await useVisitorPass(store, SECRET, 'tiny', NOW)).toEqual({ ok: false, reason: 'invalid', status: 404 })
  })

  it('revoked passes are refused, even for the bound device', async () => {
    const { store } = fakeStore({ revokedAt: new Date('2026-10-05T09:30:00Z'), boundDeviceHash: sha256(DEV_A) })
    expect(await useVisitorPass(store, SECRET, DEV_A, NOW)).toMatchObject({ ok: false, reason: 'revoked' })
  })

  it('passes outside their time window are refused and do NOT bind a device', async () => {
    const { row, store } = fakeStore()
    expect(await useVisitorPass(store, SECRET, DEV_A, new Date('2026-10-05T08:59:59Z'))).toMatchObject({ ok: false, reason: 'outside_window' })
    expect(await useVisitorPass(store, SECRET, DEV_A, new Date('2026-10-05T12:00:01Z'))).toMatchObject({ ok: false, reason: 'outside_window' })
    expect(row.boundDeviceHash).toBeNull()
  })

  it('sameHash is length-safe', () => {
    expect(sameHash('', '')).toBe(false)
    expect(sameHash('ab', 'abcd')).toBe(false)
    expect(sameHash(sha256('x'), sha256('x'))).toBe(true)
  })
})
