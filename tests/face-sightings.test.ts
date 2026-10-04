/**
 * face/sightings: camera event logging, retention, and household isolation.
 * The ML engine is mocked: an "image" is a tiny text file that says which fake face descriptor(s) it contains.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const vec = (...n: number[]) => { const a = new Array(128).fill(0); n.forEach((v, i) => (a[i] = v)); return a }
// Fake engine: image bytes look like  JPEG-header + "A:0.1,0,0|B:..." ; each part is "w:v0,v1,.." (w = box width)
vi.mock('@/face/engine', () => ({
  isLoaded: () => false,
  warmUp: async () => {},
  detectFaces: async (buf: Buffer) => {
    const txt = buf.subarray(2).toString()
    if (!txt) return []
    return txt.split('|').map((p) => {
      const [w, v] = p.split(':')
      return { descriptor: vec(...v.split(',').map(Number)), score: 0.99, box: { x: 0.2, y: 0.2, w: Number(w), h: Number(w) } }
    })
  },
}))

// Mock Ring client to avoid real API calls
vi.mock('@/lib/ring/client', () => ({
  getConnectionForHousehold: vi.fn(() => null),
  ringFetchForConnection: vi.fn(() => ({ ok: false })),
}))

import { enrollFace, setFaceStore, memoryFaceStore, recordSighting, listSightings, deleteSightings, setSightingStore, memorySightingStore, _resetPurgeClock, onCameraEvent } from '@/face'

const img = (txt: string) => Buffer.from([0xff, 0xd8, ...Buffer.from(txt)])
const HH1 = 'hh-1'
const HH2 = 'hh-2'

beforeEach(() => {
  setFaceStore(memoryFaceStore())
  setSightingStore(memorySightingStore())
  _resetPurgeClock()
})

describe('recordSighting', () => {
  beforeEach(async () => {
    await enrollFace(HH1, { name: 'Dr. Shah', image: img('0.5:0'), consent: true, ref: 'v1' })
    await enrollFace(HH1, { name: 'Courier', image: img('0.5:1'), consent: true, ref: 'v2' })
  })

  it('lists known and unknown faces in one row', async () => {
    const s = await recordSighting(HH1, img('0.6:0|0.2:5|0.3:1'), { caseId: 'case-1', deviceId: 'dev-1', source: 'ring' })
    expect(s.faces).toHaveLength(3)
    expect(s.faces[0]).toMatchObject({ status: 'known', name: 'Dr. Shah' })
    expect(s.faces[1]).toMatchObject({ status: 'unknown' })
    expect(s.faces[2]).toMatchObject({ status: 'known', name: 'Courier' })
  })

  it('never returns descriptors in the list API', async () => {
    await recordSighting(HH1, img('0.5:0'), { caseId: 'case-1' })
    const list = await listSightings(HH1)
    expect(list).toHaveLength(1)
    expect(list[0].faces[0]).not.toHaveProperty('embedding')
    expect(JSON.stringify(list)).not.toMatch(/embedding/)
  })

  it('households are isolated', async () => {
    await recordSighting(HH1, img('0.5:0'), { caseId: 'case-1' })
    await recordSighting(HH2, img('0.5:0'), { caseId: 'case-2' })
    expect(await listSightings(HH1)).toHaveLength(1)
    expect(await listSightings(HH2)).toHaveLength(1)
    await deleteSightings(HH1, { all: true })
    expect(await listSightings(HH1)).toHaveLength(0)
    expect(await listSightings(HH2)).toHaveLength(1)
  })

  it('delete by caseId and delete all', async () => {
    await recordSighting(HH1, img('0.5:0'), { caseId: 'case-1' })
    await recordSighting(HH1, img('0.5:0'), { caseId: 'case-2' })
    expect(await listSightings(HH1)).toHaveLength(2)
    expect(await deleteSightings(HH1, { caseId: 'case-1' })).toBe(1)
    expect(await listSightings(HH1)).toHaveLength(1)
    expect(await deleteSightings(HH1, { all: true })).toBe(1)
    expect(await listSightings(HH1)).toHaveLength(0)
  })

  it('respects limit parameter', async () => {
    for (let i = 0; i < 25; i++) {
      await recordSighting(HH1, img('0.5:0'), { caseId: `case-${i}` })
    }
    expect(await listSightings(HH1, { limit: 5 })).toHaveLength(5)
    expect(await listSightings(HH1, { limit: 100 })).toHaveLength(25)
  })
})

describe('purgeOldSightings', () => {
  it('removes records older than retention days', async () => {
    const { purgeOldSightings, memorySightingStore } = await import('@/face/sightings')
    const oldDate = new Date(Date.now() - 40 * 86_400_000) // 40 days ago
    // Use a custom store to inject an old record
    const customStore = memorySightingStore()
    setSightingStore(customStore)
    // Add old record directly to the custom store
    await customStore.add({ householdId: HH1, caseId: 'old-case', deviceId: null, source: 'ring', capturedAt: oldDate, faceCount: 1, faces: [] })
    // Add new record directly to the custom store
    await customStore.add({ householdId: HH1, caseId: 'new-case', deviceId: null, source: 'ring', capturedAt: new Date(), faceCount: 1, faces: [] })
    expect(await listSightings(HH1)).toHaveLength(2)
    const removed = await purgeOldSightings(Date.now())
    expect(removed).toBe(1)
    expect(await listSightings(HH1)).toHaveLength(1)
  })
})

describe('onCameraEvent', () => {
  beforeEach(async () => {
    await enrollFace(HH1, { name: 'Dr. Shah', image: img('0.5:0'), consent: true })
  })

  it('skips sim devices', async () => {
    const r = await onCameraEvent(HH1, { caseId: 'case-1', deviceId: 'sim-doorbell' })
    expect(r).toBeNull()
    const list = await listSightings(HH1)
    expect(list).toHaveLength(0)
  })

  it('records when a real device and image are provided', async () => {
    const r = await onCameraEvent(HH1, { caseId: 'case-1', deviceId: 'real-device', image: img('0.5:0') })
    expect(r).not.toBeNull()
    expect(r?.faces[0]).toMatchObject({ status: 'known', name: 'Dr. Shah' })
  })

  it('does nothing when FACE.auto is off', async () => {
    const { FACE } = await import('@/face/config')
    const originalAuto = FACE.auto
    ;(FACE as any).auto = false
    const r = await onCameraEvent(HH1, { caseId: 'case-1', deviceId: 'real-device', image: img('0.5:0') })
    expect(r).toBeNull()
    ;(FACE as any).auto = originalAuto
  })
})
