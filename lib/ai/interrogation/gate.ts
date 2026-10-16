/**
 * Gate to determine if a case is an unplanned visit that should be interrogated.
 * Unplanned means: kind === 'visitor', lane !== 'expected', no expectedId, and no recurringId.
 * A planned visit that fails its pass-word check is demoted to lane = 'normal' and then treated as unplanned.
 */

export const isUnplannedVisit = (c: { kind: string; lane?: string | null; expectedId?: string | null; recurringId?: string | null }): boolean => {
  return c.kind === 'visitor' && c.lane !== 'expected' && !c.expectedId && !c.recurringId
}
