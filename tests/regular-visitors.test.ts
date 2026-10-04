/**
 * regular-visitors.test.ts: register a face as a regular visitor, approval by a helper OR the resident,
 * camera tagging. The ML engine, DB and notifications are mocked; an "image" is a tiny text file that names a fake face.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const vec = (...n: number[]) => { const a = new Array(128).fill(0); n.forEach((v, i) => (a[i] = v)); return a }
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

const sms: { to: string; body: string }[] = []
const pushes: { id: string; payload: any }[] = []
vi.mock('@/lib/doorbell/notify', () => ({
  sendSms: (to: string, body: string) => { sms.push({ to, body }); return Promise.resolve(true) },
  pushToMembership: (id: string, payload: any) => { pushes.push({ id, payload }); return Promise.resolve() },
  recentFailures: () => ({ sms: 0, push: 0 }),
  recordFailure: () => {},
}))
vi.mock('@/lib/email', () => ({ sendEmail: () => Promise.resolve(true) }))
vi.mock('@/lib/db/households', () => ({
  getHousehold: () => Promise.resolve({ id: 'hh1', residentName: 'Asha Rao' }),
}))
vi.mock('@/lib/db/memberships', () => ({
  getApprovedMemberships: () => Promise.resolve([{ id: 'm1' }, { id: 'm2' }]),
}))
vi.mock('@/lib/db/visit-requests', () => ({
  findActiveLinkByHash: (hash: string) => Promise.resolve(hash === HASH ? { id: 'link1', householdId: 'hh1' } : null),
}))
const noteRegularVisitor = vi.fn()
vi.mock('@/lib/doorbell/store', () => ({ noteRegularVisitor: (...a: any[]) => noteRegularVisitor(...a) }))

// In-memory table for RegularVisitor
const rows = new Map<string, any>()
let n = 0
vi.mock('@/lib/db/regular-visitors', () => ({
  PURGE: { photoEnc: null, embedding: null },
  countByIp:      (ip: string)  => Promise.resolve([...rows.values()].filter(r => r.ip === ip).length),
  countByContact: (_h: string, c: string) => Promise.resolve([...rows.values()].filter(r => r.contact === c).length),
  countByLink:    () => Promise.resolve(rows.size),
  countPending:   () => Promise.resolve([...rows.values()].filter(r => r.status === 'pending').length),
  create: (data: any) => { const r = { id: `r${++n}`, createdAt: new Date(), status: 'pending', decidedAt: null, decidedBy: null, faceId: null, ...data }; rows.set(r.id, r); return Promise.resolve(r) },
  getById: (h: string, id: string) => Promise.resolve([...rows.values()].find(r => r.id === id && r.householdId === h) ?? null),
  getByToken: (t: string) => Promise.resolve([...rows.values()].find(r => r.statusToken === t) ?? null),
  update: (id: string, d: any) => { Object.assign(rows.get(id), d); return Promise.resolve(rows.get(id)) },
  list: (h: string, st: string[]) => Promise.resolve([...rows.values()].filter(r => r.householdId === h && st.includes(r.status))),
  findExpirable: (h: string, now: Date) => Promise.resolve([...rows.values()].filter(r => r.householdId === h && r.status === 'pending' && r.expiresAt <= now)),
  listPendingForHousehold: (h: string) => Promise.resolve([...rows.values()].filter(r => r.householdId === h && r.status === 'pending')),
  transition: (id: string, from: string[], d: any) => {
    const r = rows.get(id)
    if (!r || !from.includes(r.status)) return Promise.resolve(false)
    Object.assign(r, d); return Promise.resolve(true)
  },
}))

import { hashToken } from '@/lib/visit-tokens'
import { setFaceStore, memoryFaceStore, matchFace, listFaces, FACE } from '@/face'
import {
  submitRegistration, decideRegistration, removeRegular, withdraw, visitorView,
  listForApprover, photoFor, sweepRegistrations, annotateCaseFromSighting, regularRef,
} from '@/lib/doorbell/regular'

const TOKEN = 'link-token'
const HASH = hashToken(TOKEN)
const pic = (txt: string) => Buffer.from([0xff, 0xd8, ...Buffer.from(txt)]).toString('base64')

const base = { linkToken: TOKEN, name: 'Priya', purpose: 'carer' as const, contactRaw: '+919876543210', ip: '1.1.1.1' }
const submit = (txt: string, over: Partial<typeof base> & { contactRaw?: string; ip?: string } = {}) =>
  submitRegistration({ ...base, ...over, image: 'data:image/jpeg;base64,' + pic(txt) })

beforeEach(() => {
  rows.clear(); n = 0; sms.length = 0; pushes.length = 0; noteRegularVisitor.mockReset()
  setFaceStore(memoryFaceStore())
})

describe('submit', () => {
  it('stores a pending registration with an encrypted photo and sealed face, and quietly alerts every helper', async () => {
    const r = await submit('0.5:0')
    expect(r.ok).toBe(true)
    const row = [...rows.values()][0]
    expect(row.status).toBe('pending')
    expect(row.photoEnc).toMatch(/^(enc|raw):/)
    expect(row.embedding).toMatch(/^(enc|raw):/)
    expect(await listFaces('hh1')).toHaveLength(0)           // nothing enrolled before approval
    await new Promise(r => setTimeout(r, 0))
    expect(pushes.map(p => p.id).sort()).toEqual(['m1', 'm2'])
    expect(sms).toHaveLength(0)                              // not urgent: no SMS
  })

  it('rejects an inactive link, a bad contact, and pictures without exactly one clear face', async () => {
    expect(await submitRegistration({ ...base, linkToken: 'nope', image: 'data:image/jpeg;base64,' + pic('0.5:0') })).toMatchObject({ ok: false, status: 404 })
    expect(await submit('0.5:0', { contactRaw: 'abc' })).toMatchObject({ ok: false, status: 400 })
    expect(await submit('')).toMatchObject({ ok: false, status: 422, error: expect.stringMatching(/No face/) })
    expect(await submit('0.5:0|0.5:1')).toMatchObject({ ok: false, status: 422, error: expect.stringMatching(/More than one/) })
    expect(await submit('0.05:0')).toMatchObject({ ok: false, status: 422, error: expect.stringMatching(/too small/) })
    expect(rows.size).toBe(0)
  })

  it('refuses a face that is already registered, without saying who', async () => {
    const a = await submit('0.5:0'); expect(a.ok).toBe(true)
    await decideRegistration('hh1', 'r1', { kind: 'helper', membershipId: 'm1' }, 'approve')
    const b = await submit('0.5:0.05', { contactRaw: '+919800000001', ip: '2.2.2.2' })
    expect(b).toMatchObject({ ok: false, status: 409, error: 'This face is already registered.' })
  })

  it('limits requests per contact', async () => {
    expect((await submit('0.5:0')).ok).toBe(true)
    expect((await submit('0.5:1')).ok).toBe(true)
    expect(await submit('0.5:2')).toMatchObject({ ok: false, status: 429 })
  })
})

describe('approval: a helper OR the resident', () => {
  beforeEach(async () => { await submit('0.5:0') })

  it('a helper approves: face is enrolled under reg:<id>, photo and sealed copy are erased, visitor is told', async () => {
    const r = await decideRegistration('hh1', 'r1', { kind: 'helper', membershipId: 'm1' }, 'approve')
    expect(r).toEqual({ ok: true, status: 'approved' })
    const row = rows.get('r1')
    expect(row).toMatchObject({ status: 'approved', decidedBy: 'helper:m1', photoEnc: null, embedding: null })
    const faces = await listFaces('hh1')
    expect(faces).toHaveLength(1)
    expect(faces[0]).toMatchObject({ name: 'Priya', ref: regularRef('r1') })
    expect((await matchFace('hh1', Buffer.from([0xff, 0xd8, ...Buffer.from('0.5:0.05')]))).matched).toBe(true)
    await new Promise(r => setTimeout(r, 0))
    expect(sms[0].to).toBe('+919876543210')
    expect(sms[0].body).toMatch(/regular visitor/)
  })

  it('the resident can approve on their own (no helper needed)', async () => {
    const r = await decideRegistration('hh1', 'r1', { kind: 'resident' }, 'approve')
    expect(r).toEqual({ ok: true, status: 'approved' })
    expect(rows.get('r1').decidedBy).toBe('resident')
    expect(await listFaces('hh1')).toHaveLength(1)
  })

  it('the first answer wins: a second approver or a late decline gets 409 and nothing is enrolled twice', async () => {
    await decideRegistration('hh1', 'r1', { kind: 'helper', membershipId: 'm1' }, 'approve')
    expect(await decideRegistration('hh1', 'r1', { kind: 'resident' }, 'approve')).toMatchObject({ ok: false, status: 409 })
    expect(await decideRegistration('hh1', 'r1', { kind: 'helper', membershipId: 'm2' }, 'decline')).toMatchObject({ ok: false, status: 409 })
    expect(await listFaces('hh1')).toHaveLength(1)
  })

  it('decline erases the photo and enrols nothing', async () => {
    expect(await decideRegistration('hh1', 'r1', { kind: 'resident' }, 'decline')).toEqual({ ok: true, status: 'declined' })
    expect(rows.get('r1')).toMatchObject({ status: 'declined', photoEnc: null, embedding: null })
    expect(await listFaces('hh1')).toHaveLength(0)
    expect(await photoFor('hh1', 'r1')).toBeNull()
  })

  it('when the face limit is reached the approval rolls back so it can be retried', async () => {
    const old = FACE.maxPerHousehold; FACE.maxPerHousehold = 0
    try {
      const r = await decideRegistration('hh1', 'r1', { kind: 'helper', membershipId: 'm1' }, 'approve')
      expect(r).toMatchObject({ ok: false, status: 409 })
      expect(rows.get('r1')).toMatchObject({ status: 'pending', decidedBy: null })
      expect(rows.get('r1').embedding).toBeTruthy()
    } finally { FACE.maxPerHousehold = old }
    expect(await decideRegistration('hh1', 'r1', { kind: 'resident' }, 'approve')).toMatchObject({ ok: true })
  })

  it('another household cannot decide it', async () => {
    expect(await decideRegistration('hh-other', 'r1', { kind: 'resident' }, 'approve')).toMatchObject({ ok: false, status: 404 })
  })
})

describe('expiry, withdraw, remove', () => {
  beforeEach(async () => { await submit('0.5:0') })

  it('an unanswered registration expires, its photo is erased, and the visitor is told', async () => {
    rows.get('r1').expiresAt = new Date(Date.now() - 1000)
    await sweepRegistrations('hh1')
    expect(rows.get('r1')).toMatchObject({ status: 'expired', photoEnc: null, embedding: null })
    await new Promise(r => setTimeout(r, 0))
    expect(sms.some(s => /not answered in time/.test(s.body))).toBe(true)
    expect(await decideRegistration('hh1', 'r1', { kind: 'resident' }, 'approve')).toMatchObject({ ok: false, status: 409 })
  })

  it('the visitor can cancel while pending, and erase themselves once approved', async () => {
    const token = rows.get('r1').statusToken
    expect(await withdraw(token)).toEqual({ ok: true })
    expect(rows.get('r1').status).toBe('cancelled')

    await submit('0.5:1', { contactRaw: '+919800000002', ip: '3.3.3.3' })
    await decideRegistration('hh1', 'r2', { kind: 'resident' }, 'approve')
    expect(await listFaces('hh1')).toHaveLength(1)
    expect(await withdraw(rows.get('r2').statusToken)).toEqual({ ok: true })
    expect(await listFaces('hh1')).toHaveLength(0)
    expect(rows.get('r2').status).toBe('removed')
  })

  it('a guardian removing a regular deletes the face', async () => {
    await decideRegistration('hh1', 'r1', { kind: 'helper', membershipId: 'm1' }, 'approve')
    expect(await removeRegular('hh1', 'r1')).toEqual({ ok: true })
    expect(await listFaces('hh1')).toHaveLength(0)
    expect(await removeRegular('hh1', 'r1')).toMatchObject({ ok: false, status: 409 })
  })
})

describe('what each screen may see', () => {
  it('the visitor never gets the photo or contact; the resident never gets the approved list; lists carry no photo or contact', async () => {
    await submit('0.5:0')
    const v = await visitorView(rows.get('r1').statusToken)
    expect(Object.keys(v!).sort()).toEqual(['name', 'purpose', 'resident', 'status'])
    const res = await listForApprover('hh1', 'resident')
    expect(res.approved).toEqual([])
    expect(JSON.stringify(res)).not.toMatch(/photo|contact"|embedding|\+91/)
    const photo = await photoFor('hh1', 'r1')
    expect(photo?.mime).toBe('image/jpeg')
  })
})

describe('camera: count a recognised face as a regular visitor', () => {
  beforeEach(async () => {
    await submit('0.5:0')
    await decideRegistration('hh1', 'r1', { kind: 'resident' }, 'approve')
  })
  const face = (o: any) => ({ faces: [{ status: 'known', ref: regularRef('r1'), strength: 'strong', ...o }] })

  it('tags the open case on a strong match', async () => {
    await annotateCaseFromSighting('hh1', 'case1', face({}))
    expect(noteRegularVisitor).toHaveBeenCalledWith('hh1', 'case1', expect.objectContaining({ id: 'r1', name: 'Priya', icon: '🧑‍⚕️' }))
  })
  it('ignores weak matches by default, other guests, unknown faces, no case, and removed regulars', async () => {
    await annotateCaseFromSighting('hh1', 'case1', face({ strength: 'ok' }))
    await annotateCaseFromSighting('hh1', 'case1', face({ ref: 'visit-123' }))
    await annotateCaseFromSighting('hh1', 'case1', face({ status: 'unknown' }))
    await annotateCaseFromSighting('hh1', null, face({}))
    await removeRegular('hh1', 'r1')
    await annotateCaseFromSighting('hh1', 'case1', face({}))
    expect(noteRegularVisitor).not.toHaveBeenCalled()
  })
})
