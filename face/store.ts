/**
 * Where enrolled descriptors live. The default store uses Prisma (table GuestFace). Descriptors are
 * biometric data, so they are encrypted with TOKEN_ENC_KEY when it is set. No photo is ever stored.
 * Tests (or another backend) can swap the store with setFaceStore().
 */
import { getDb } from '@/lib/db/client'
import { encrypt, decrypt } from '@/lib/auth'
import type { StoredFace } from './types'

export interface FaceStore {
  add(f: Omit<StoredFace, 'id' | 'createdAt'>): Promise<StoredFace>
  list(householdId: string): Promise<StoredFace[]>
  count(householdId: string): Promise<number>
  remove(householdId: string, id: string): Promise<number>
  removeGuest(householdId: string, by: { name?: string; ref?: string }): Promise<number>
}

export const seal = (d: number[]) => {
  const json = JSON.stringify(d.map((n) => Math.round(n * 1e6) / 1e6))
  const e = encrypt(json)
  return e ? 'enc:' + e : 'raw:' + json
}
export const open = (s: string): number[] | null => {
  try {
    if (s.startsWith('enc:')) { const p = decrypt(s.slice(4)); return p ? JSON.parse(p) : null }
    if (s.startsWith('raw:')) return JSON.parse(s.slice(4))
  } catch { /* fall through */ }
  return null
}

const prismaStore: FaceStore = {
  async add(f) {
    const r = await getDb().guestFace.create({
      data: { householdId: f.householdId, name: f.name, ref: f.ref ?? null, embedding: seal(f.descriptor), consentAt: f.consentAt, createdBy: f.createdBy ?? null },
    })
    return { ...f, id: r.id, createdAt: r.createdAt }
  },
  async list(householdId) {
    const rows = await getDb().guestFace.findMany({ where: { householdId }, orderBy: { createdAt: 'asc' } })
    return rows.flatMap((r: any) => {
      const descriptor = open(r.embedding)
      return descriptor ? [{ id: r.id, householdId: r.householdId, name: r.name, ref: r.ref, descriptor, consentAt: r.consentAt, createdBy: r.createdBy, createdAt: r.createdAt }] : []
    })
  },
  count: (householdId) => getDb().guestFace.count({ where: { householdId } }),
  async remove(householdId, id) {
    return (await getDb().guestFace.deleteMany({ where: { id, householdId } })).count
  },
  async removeGuest(householdId, by) {
    if (!by.name && !by.ref) return 0
    const where: any = { householdId }
    if (by.name) where.name = by.name
    if (by.ref) where.ref = by.ref
    return (await getDb().guestFace.deleteMany({ where })).count
  },
}

/** In-memory store for tests and demos. */
export function memoryFaceStore(): FaceStore {
  let rows: StoredFace[] = []
  let n = 0
  return {
    async add(f) { const r = { ...f, id: `f${++n}`, createdAt: new Date() }; rows.push(r); return r },
    async list(h) { return rows.filter((r) => r.householdId === h) },
    async count(h) { return rows.filter((r) => r.householdId === h).length },
    async remove(h, id) { const b = rows.length; rows = rows.filter((r) => !(r.householdId === h && r.id === id)); return b - rows.length },
    async removeGuest(h, by) {
      if (!by.name && !by.ref) return 0
      const b = rows.length
      rows = rows.filter((r) => !(r.householdId === h && (!by.name || r.name === by.name) && (!by.ref || r.ref === by.ref)))
      return b - rows.length
    },
  }
}

let active: FaceStore = prismaStore
export const faceStore = () => active
export const setFaceStore = (s: FaceStore | null) => { active = s ?? prismaStore }
