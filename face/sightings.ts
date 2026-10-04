import { getDb } from '@/lib/db/client'
import { FACE } from './config'
import { detectFaces } from './engine'
import { bestGuest } from './match'
import { faceStore, seal } from './store'
import { readImage, type ImageInput } from './index'
import type { Sighting, SightingFace } from './types'

export interface SightingStore {
  add(s: Omit<Sighting, 'id'>): Promise<Sighting>
  list(householdId: string, o: { caseId?: string; limit: number }): Promise<Sighting[]>
  remove(householdId: string, o: { caseId?: string; all?: boolean }): Promise<number>
  purgeBefore(cutoff: Date): Promise<number>
}

const prismaSightings: SightingStore = {
  async add(s) {
    const r = await getDb().faceSighting.create({
      data: { householdId: s.householdId, caseId: s.caseId ?? null, deviceId: s.deviceId ?? null, source: s.source, capturedAt: s.capturedAt, faceCount: s.faceCount, faces: s.faces as any },
    })
    return { ...s, id: r.id }
  },
  async list(householdId, o) {
    const rows = await getDb().faceSighting.findMany({ where: { householdId, ...(o.caseId ? { caseId: o.caseId } : {}) }, orderBy: { capturedAt: 'desc' }, take: o.limit })
    return rows.map((r: any) => ({ id: r.id, householdId: r.householdId, caseId: r.caseId, deviceId: r.deviceId, source: r.source, capturedAt: r.capturedAt, faceCount: r.faceCount, faces: (r.faces ?? []) as SightingFace[] }))
  },
  async remove(householdId, o) {
    if (!o.caseId && !o.all) return 0
    return (await getDb().faceSighting.deleteMany({ where: { householdId, ...(o.caseId ? { caseId: o.caseId } : {}) } })).count
  },
  async purgeBefore(cutoff) {
    return (await getDb().faceSighting.deleteMany({ where: { capturedAt: { lt: cutoff } } })).count
  },
}

export function memorySightingStore(): SightingStore {
  let rows: Sighting[] = []
  let n = 0
  return {
    async add(s) { const r = { ...s, id: `s${++n}` }; rows.push(r); return r },
    async list(h, o) { return rows.filter((r) => r.householdId === h && (!o.caseId || r.caseId === o.caseId)).sort((a, b) => +b.capturedAt - +a.capturedAt).slice(0, o.limit) },
    async remove(h, o) {
      if (!o.caseId && !o.all) return 0
      const b = rows.length
      rows = rows.filter((r) => !(r.householdId === h && (!o.caseId || r.caseId === o.caseId)))
      return b - rows.length
    },
    async purgeBefore(c) { const b = rows.length; rows = rows.filter((r) => +r.capturedAt >= +c); return b - rows.length },
  }
}

let active: SightingStore = prismaSightings
export const setSightingStore = (s: SightingStore | null) => { active = s ?? prismaSightings }

let lastPurge = 0
export async function purgeOldSightings(now = Date.now()): Promise<number> {
  if (now - lastPurge < 3_600_000) return 0
  lastPurge = now
  try { return await active.purgeBefore(new Date(now - FACE.retentionDays * 86_400_000)) } catch (e) { console.error('[FACE] purge failed', e); return 0 }
}
export const _resetPurgeClock = () => { lastPurge = 0 }   // tests only

export async function recordSighting(
  householdId: string, image: ImageInput,
  meta: { caseId?: string | null; deviceId?: string | null; source?: string } = {}
): Promise<Sighting> {
  const detected = (await detectFaces(readImage(image))).slice(0, FACE.maxFacesPerImage)
  const pool = await faceStore().list(householdId)

  const faces: SightingFace[] = detected.map((f, i) => {
    const pick = bestGuest(pool, f.descriptor)
    const base: SightingFace = { i, box: f.box, score: Math.round(f.score * 1000) / 1000, status: 'unknown' }
    if (pick.distance !== undefined) base.distance = pick.distance
    if (pick.reason === 'match' && pick.guest) {
      base.status = 'known'; base.name = pick.guest.name; base.ref = pick.guest.ref ?? null; base.faceId = pick.guest.id; base.strength = pick.strength
    } else if (pick.reason === 'ambiguous') base.status = 'ambiguous'
    if (FACE.storeDescriptors) base.embedding = seal(f.descriptor)
    return base
  })

  const saved = await active.add({ householdId, caseId: meta.caseId ?? null, deviceId: meta.deviceId ?? null, source: meta.source ?? 'upload', capturedAt: new Date(), faceCount: detected.length, faces })
  void purgeOldSightings()
  return saved
}

export async function listSightings(householdId: string, o: { caseId?: string; limit?: number } = {}) {
  const rows = await active.list(householdId, { caseId: o.caseId, limit: Math.min(Math.max(o.limit ?? 20, 1), 100) })
  return rows.map((r) => ({ ...r, faces: r.faces.map(({ embedding, ...rest }) => rest) }))
}

export const deleteSightings = (householdId: string, o: { caseId?: string; all?: boolean }) => active.remove(householdId, o)
