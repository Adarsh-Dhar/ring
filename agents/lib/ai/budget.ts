/**
 * Per-model RPM / RPD counters. Redis when available, in-process otherwise.
 * `reserve()` never throws: out of budget just means "no AI result" and the caller degrades.
 */
import { getRedis } from '@/lib/redis'
import { limitsFor, MODEL_IDS, type ModelRole } from './models'

const mem = new Map<string, { n: number; exp: number }>()

function memIncr(key: string, ttlMs: number): number {
  const now = Date.now()
  const e = mem.get(key)
  if (!e || e.exp <= now) { mem.set(key, { n: 1, exp: now + ttlMs }); return 1 }
  e.n += 1
  return e.n
}

async function incr(key: string, ttlSec: number): Promise<number> {
  if (process.env.REDIS_URL) {
    try {
      const r = getRedis()
      const n = await r.incr(key)
      if (n === 1) await r.expire(key, ttlSec)
      return n
    } catch { /* fall through to memory */ }
  }
  return memIncr(key, ttlSec * 1000)
}

async function decr(key: string): Promise<void> {
  if (process.env.REDIS_URL) { try { await getRedis().decr(key); return } catch { /* memory */ } }
  const e = mem.get(key); if (e && e.n > 0) e.n -= 1
}

const dayKey = () => new Date().toISOString().slice(0, 10)       // UTC day
const minKey = () => Math.floor(Date.now() / 60_000)

/** Take one request from `role`'s budget. Returns the model ID to call, or null if exhausted. */
export async function reserve(role: ModelRole): Promise<string | null> {
  const lim = limitsFor(role)
  const model = MODEL_IDS[role]()
  const mKey = `ai:rpm:${model}:${minKey()}`
  const dKey = `ai:rpd:${model}:${dayKey()}`
  const m = await incr(mKey, 70)
  if (m > lim.rpm) { await decr(mKey); return null }
  const d = await incr(dKey, 60 * 60 * 26)
  if (d > lim.rpd) { await decr(dKey); await decr(mKey); return null }
  return model
}

/** Used by /api/ai/usage. */
export async function usageSnapshot(): Promise<Record<string, { rpmUsed: number; rpdUsed: number; rpm: number; rpd: number; model: string }>> {
  const out: Record<string, any> = {}
  for (const role of ['workhorse', 'quality', 'fallback', 'embedding', 'tts'] as ModelRole[]) {
    const model = MODEL_IDS[role]()
    const lim = limitsFor(role)
    let rpmUsed = 0, rpdUsed = 0
    const mk = `ai:rpm:${model}:${minKey()}`, dk = `ai:rpd:${model}:${dayKey()}`
    if (process.env.REDIS_URL) {
      try { const r = getRedis(); rpmUsed = Number(await r.get(mk)) || 0; rpdUsed = Number(await r.get(dk)) || 0 } catch { /* ignore */ }
    } else { rpmUsed = mem.get(mk)?.n ?? 0; rpdUsed = mem.get(dk)?.n ?? 0 }
    out[role] = { model, rpmUsed, rpdUsed, rpm: lim.rpm, rpd: lim.rpd }
  }
  return out
}

export function _resetBudget() { mem.clear() }   // tests only
