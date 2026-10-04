/**
 * A paired resident screen only holds the db_device cookie. getSession must turn it into a resident session,
 * otherwise /api/doorbell/state and the resident approvals answer 401 on that screen.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const devices = new Map<string, { householdId: string }>()
let residentEpoch = 1
vi.mock('@/lib/db/client', () => ({
  getDb: () => ({ residentDevice: { findUnique: ({ where }: any) => Promise.resolve(devices.get(where.id) ?? null) } }),
}))
vi.mock('@/lib/db/households', () => ({
  getResidentEpoch: () => Promise.resolve(residentEpoch),
  getDeviceEpoch: () => Promise.resolve(1),
}))
vi.mock('@/lib/db/memberships', () => ({ getMembershipEpoch: () => Promise.resolve(1) }))

import { makeToken } from '@/lib/auth'
import { getSession, DEVICE_COOKIE } from '@/lib/guard'

process.env.AUTH_SECRET = 'a'.repeat(32)
const exp = () => Math.floor(Date.now() / 1000) + 3600
const reqWith = (cookie?: string) => new NextRequest('http://localhost/api/doorbell/state', { headers: cookie ? { cookie } : {} })
const deviceCookie = (o: Partial<{ sub: string; householdId: string; epoch: number; kind: string }> = {}) =>
  `${DEVICE_COOKIE}=${makeToken({ kind: 'device', sub: 'dev1', householdId: 'hh1', epoch: 1, exp: exp(), ...o })}`

beforeEach(() => { devices.clear(); devices.set('dev1', { householdId: 'hh1' }); residentEpoch = 1 })

describe('resident device session', () => {
  it('a paired device is a resident session for its household', async () => {
    expect(await getSession(reqWith(deviceCookie()))).toEqual({ kind: 'resident', userId: 'dev1', householdId: 'hh1' })
  })
  it('no cookie, a forged token, an unknown device, a wrong household or an old epoch are all refused', async () => {
    expect(await getSession(reqWith())).toBeNull()
    expect(await getSession(reqWith(`${DEVICE_COOKIE}=a.b.c`))).toBeNull()
    expect(await getSession(reqWith(deviceCookie({ sub: 'ghost' })))).toBeNull()
    expect(await getSession(reqWith(deviceCookie({ householdId: 'hh2' })))).toBeNull()
    residentEpoch = 2
    expect(await getSession(reqWith(deviceCookie()))).toBeNull()
  })
  it('only a device token counts (a helper-kind token in the device cookie does not)', async () => {
    expect(await getSession(reqWith(deviceCookie({ kind: 'helper' })))).toBeNull()
  })
})
