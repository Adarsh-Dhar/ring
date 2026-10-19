/**
 * Contact order (Section 7.3): primary helpers first, then backup, then third, and by position inside a tier.
 * Pure and import-free so it is trivial to test. Rows with no tier count as primary, and the sort is stable,
 * so rows that tie keep the order the database gave them.
 */
export type Tier = 'primary' | 'backup' | 'third'
const TIER_ORDER: Record<Tier, number> = { primary: 0, backup: 1, third: 2 }

export interface Orderable { id: string; tier?: string | null; position?: number | null }

export function sortByTier<T extends Orderable>(rows: readonly T[]): T[] {
  const rank = (r: T) => TIER_ORDER[(r.tier as Tier) ?? 'primary'] ?? 0
  return [...rows].sort((a, b) => rank(a) - rank(b) || (a.position ?? 0) - (b.position ?? 0))
}

export const chainFrom = (rows: readonly Orderable[]): string[] => sortByTier(rows).map(r => r.id)
