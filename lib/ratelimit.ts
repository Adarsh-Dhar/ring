import type { NextRequest } from 'next/server'

type Bucket = { n: number; resetAt: number }
const buckets = new Map<string, Bucket>()

/** true = allowed. Fixed window, in memory (single process). */
export function hit(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const b = buckets.get(key)
  if (!b || b.resetAt <= now) {
    buckets.set(key, { n: 1, resetAt: now + windowMs })
    // Prune stale buckets periodically to prevent unbounded growth
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k)
    }
    return true
  }
  if (b.n >= max) return false
  b.n++
  return true
}

/** Same extraction send-otp uses. Caddy sets X-Forwarded-For; do not expose the app port directly. */
export const clientIp = (req: NextRequest, trustXForwardedFor = false) => {
  if (trustXForwardedFor) {
    return (req.headers.get('x-forwarded-for')?.split(',')[0] ?? '').trim() || 'unknown'
  }
  // Otherwise use the socket address (not accessible in Edge runtime, but fine for Node.js)
  return 'unknown'
}

export function _resetRateLimits() { buckets.clear() }   // tests only
