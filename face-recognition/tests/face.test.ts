/**
 * face/: enrol, match, safety rules. The ML engine is mocked: an "image" is a tiny text file that says
 * which fake face descriptor(s) it contains, so the tests are fast and need no models.
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

import { enrollFace, matchFace, listFaces, deleteFace, deleteGuest, readImage, setFaceStore, memoryFaceStore, FaceError } from '@/face'

const img = (txt: string) => Buffer.from([0xff, 0xd8, ...Buffer.from(txt)])
const HH = 'hh-1'

beforeEach(() => setFaceStore(memoryFaceStore()))

describe('enrol', () => {
  it('needs consent', async () => {
    await expect(enrollFace(HH, { name: 'Dr. Shah', image: img('0.5:0'), consent: false as any })).rejects.toMatchObject({ code: 'consent_required' })
  })
  it('rejects photos with no face, several faces, or a tiny face', async () => {
    await expect(enrollFace(HH, { name: 'A', image: img(''), consent: true })).rejects.toMatchObject({ code: 'no_face' })
    await expect(enrollFace(HH, { name: 'A', image: img('0.5:0|0.5:1'), consent: true })).rejects.toMatchObject({ code: 'multiple_faces' })
    await expect(enrollFace(HH, { name: 'A', image: img('0.05:0'), consent: true })).rejects.toMatchObject({ code: 'face_too_small' })
  })
  it('stores a name, never the photo, and lists without biometric data', async () => {
    await enrollFace(HH, { name: 'Dr. Shah', image: img('0.5:0'), consent: true, ref: 'visit-1' })
    const l = await listFaces(HH)
    expect(l).toHaveLength(1)
    expect(l[0]).toMatchObject({ name: 'Dr. Shah', ref: 'visit-1' })
    expect(JSON.stringify(l)).not.toMatch(/descriptor|embedding/)
  })
})

describe('match', () => {
  beforeEach(async () => {
    await enrollFace(HH, { name: 'Dr. Shah', image: img('0.5:0'), consent: true, ref: 'v1' })
    await enrollFace(HH, { name: 'Courier', image: img('0.5:1'), consent: true, ref: 'v2' })
  })
  it('matches the same face strongly', async () => {
    const r = await matchFace(HH, img('0.5:0.05'))
    expect(r).toMatchObject({ matched: true, reason: 'match', strength: 'strong', guest: { name: 'Dr. Shah' } })
  })
  it('does not match a stranger', async () => {
    const r = await matchFace(HH, img('0.5:5'))
    expect(r).toMatchObject({ matched: false, reason: 'too_far' })
  })
  it('reports no_face when the picture has no face', async () => {
    expect(await matchFace(HH, img(''))).toMatchObject({ matched: false, reason: 'no_face', faces: 0 })
  })
  it('checks only the expected guest when ref is given (1:1)', async () => {
    expect(await matchFace(HH, img('0.5:0.05'), { ref: 'v2' })).toMatchObject({ matched: false, reason: 'too_far' })
    expect(await matchFace(HH, img('0.5:0.05'), { ref: 'v1' })).toMatchObject({ matched: true })
    expect(await matchFace(HH, img('0.5:0.05'), { ref: 'nobody' })).toMatchObject({ matched: false, reason: 'no_enrolled' })
  })
  it('reports how many faces were in view', async () => {
    const r = await matchFace(HH, img('0.6:0|0.2:1'))   // the real engine returns the largest face first, and that is the one compared
    expect(r.faces).toBe(2)
    expect(r.guest?.name).toBe('Dr. Shah')
  })
  it('refuses to guess when two different guests look equally close', async () => {
    await enrollFace(HH, { name: 'Twin', image: img('0.5:0.02'), consent: true, ref: 'v3' })
    expect(await matchFace(HH, img('0.5:0.01'))).toMatchObject({ matched: false, reason: 'ambiguous' })
  })
  it('never matches another household', async () => {
    expect(await matchFace('hh-2', img('0.5:0.05'))).toMatchObject({ matched: false, reason: 'no_enrolled' })
  })
})

describe('delete', () => {
  it('removes one face, or all faces of a guest, scoped to the household', async () => {
    const a = await enrollFace(HH, { name: 'Dr. Shah', image: img('0.5:0'), consent: true, ref: 'v1' })
    await enrollFace(HH, { name: 'Dr. Shah', image: img('0.5:0.1'), consent: true, ref: 'v1' })
    expect(await deleteFace('hh-2', a.id)).toBe(0)
    expect(await deleteFace(HH, a.id)).toBe(1)
    expect(await deleteGuest(HH, { ref: 'v1' })).toBe(1)
    expect(await listFaces(HH)).toHaveLength(0)
    expect(await deleteGuest(HH, {})).toBe(0)   // empty filter must not wipe everything
  })
})

describe('readImage', () => {
  it('accepts a data URL, rejects junk and oversize files', () => {
    const b64 = img('0.5:0').toString('base64')
    expect(readImage(`data:image/jpeg;base64,${b64}`).length).toBeGreaterThan(2)
    expect(() => readImage('not base64!!')).toThrow(FaceError)
    expect(() => readImage(Buffer.from('hello world'))).toThrow(/JPEG, PNG or WebP/)
    expect(() => readImage(Buffer.alloc(5_000_000, 0xff))).toThrow(/larger than/)
  })
})
