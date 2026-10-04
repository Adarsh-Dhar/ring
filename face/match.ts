import { FACE } from './config'
import { distance } from './math'
import type { MatchReason, StoredFace } from './types'

export type Pick = { reason: MatchReason; guest?: StoredFace; distance?: number; strength?: 'strong' | 'ok' }

/** Compare one descriptor with a pool of saved faces. Shared by matchFace and the camera sightings. */
export function bestGuest(pool: StoredFace[], descriptor: number[]): Pick {
  if (pool.length === 0) return { reason: 'no_enrolled' }
  const best = new Map<string, { face: StoredFace; d: number }>()
  for (const p of pool) {
    const d = distance(descriptor, p.descriptor)
    const key = `${p.name}\u0000${p.ref ?? ''}`
    const cur = best.get(key)
    if (!cur || d < cur.d) best.set(key, { face: p, d })
  }
  const ranked = [...best.values()].sort((a, b) => a.d - b.d)
  const top = ranked[0]
  const d = Math.round(top.d * 1000) / 1000
  if (top.d > FACE.threshold) return { reason: 'too_far', distance: d }
  if (ranked.length > 1 && ranked[1].d - top.d < FACE.ambiguityMargin && ranked[1].d <= FACE.threshold) return { reason: 'ambiguous', distance: d }
  return { reason: 'match', guest: top.face, distance: d, strength: top.d <= FACE.strongThreshold ? 'strong' : 'ok' }
}
