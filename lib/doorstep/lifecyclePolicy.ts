/**
 * Section 8.2 resident-set values: the quiet period before an idle case closes (pilot default 10 minutes) and the
 * look-back window for earlier serious events shown to the helper (pilot default 24 hours).
 */
import { getDb } from '@/lib/db/client'

export const DEFAULT_QUIET_MINUTES = 10
export const DEFAULT_LOOKBACK_HOURS = 24
export const QUIET_MINUTES_RANGE = { min: 1, max: 120 } as const
export const LOOKBACK_HOURS_RANGE = { min: 1, max: 168 } as const

export interface LifecyclePolicy { quietMinutes: number; lookbackHours: number }

const clamp = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback
}

/** Tolerant read: anything missing or out of range falls back to the pilot default or the nearest bound. */
export function parseLifecyclePolicy(raw: { quietPeriodMin?: unknown; priorLookbackHours?: unknown } | null | undefined): LifecyclePolicy {
  return {
    quietMinutes: clamp(raw?.quietPeriodMin, QUIET_MINUTES_RANGE.min, QUIET_MINUTES_RANGE.max, DEFAULT_QUIET_MINUTES),
    lookbackHours: clamp(raw?.priorLookbackHours, LOOKBACK_HOURS_RANGE.min, LOOKBACK_HOURS_RANGE.max, DEFAULT_LOOKBACK_HOURS),
  }
}

/** Never throws: a read failure gives the pilot defaults. */
export async function getLifecyclePolicy(householdId: string): Promise<LifecyclePolicy> {
  try {
    const h = await getDb().household.findUnique({ where: { id: householdId }, select: { quietPeriodMin: true, priorLookbackHours: true } as any })
    return parseLifecyclePolicy(h as any)
  } catch {
    return parseLifecyclePolicy(null)
  }
}

export async function setLifecyclePolicy(householdId: string, input: Partial<LifecyclePolicy>): Promise<LifecyclePolicy> {
  const cur = await getLifecyclePolicy(householdId)
  const next = parseLifecyclePolicy({
    quietPeriodMin: input.quietMinutes ?? cur.quietMinutes,
    priorLookbackHours: input.lookbackHours ?? cur.lookbackHours,
  })
  await getDb().household.update({ where: { id: householdId }, data: { quietPeriodMin: next.quietMinutes, priorLookbackHours: next.lookbackHours } as any })
  return next
}
