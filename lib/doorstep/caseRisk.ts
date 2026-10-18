/**
 * Stored risk observations: merge fresh model passes with the existing store, apply helper actions.
 * Pure functions. No database access. The database layer is in caseRiskStore.ts.
 *
 * Round 2 patches: #2 (model events never scored), #13 (reject uses wrong index)
 * P11: stamps are now their own type, not observations
 */
import type { Observation, ControlMode, RiskScore, LedgerEntry, InterviewStamp, InterviewState } from './riskRules'

/**
 * The structure stored in Case.riskObservations (JSON column).
 * Round 2: observations array replaces the old ledger array. The ledger is computed from observations.
 * P11: stamps are stored separately from observations.
 */
export interface StoredRisk {
  /** All observations collected for this case, in the order they arrived. */
  observations: Observation[]
  /** Interview state stamps (timestamps of key interview milestones). */
  stamps: InterviewStamp[]
  /** Interview state (key milestone timestamps). */
  interviewState: Record<string, string>
  /** Helper corrections: index-based confirm/reject actions. */
  corrections: Correction[]
  /** Step 4: device availability (camera / mic). Present when a device was unavailable during the case. */
  availability?: {
    camera?: { since: string; reason: string }
    mic?:    { since: string; reason: string }
  }
}

export interface Correction {
  /** Position in the observations array this correction applies to.
   *  @deprecated Use obsId when available. */
  idx: number
  /** Stable observation id. Preferred over idx. */
  obsId?: string
  /** Action taken. */
  action: 'confirm' | 'reject' | 'restore' | 'resolve'
  /** ISO timestamp when the helper acted. */
  at: string
  /** P5: Helper ID who made this correction (for audit trail). */
  who: string
  /** P5: Reason for the correction (required for restore, optional otherwise). */
  reason?: string
}

/**
 * Read the stored observations. The old format (a ledger array) reads as empty.
 * This allows a safe migration without breaking existing cases.
 */
export function readStored(raw: unknown): StoredRisk {
  if (!raw || typeof raw !== 'object') return { observations: [], stamps: [], interviewState: {}, corrections: [] }
  const r = raw as Record<string, unknown>
  if (Array.isArray(r)) return { observations: [], stamps: [], interviewState: {}, corrections: [] } // Old ledger format
  const obs = Array.isArray(r.observations) ? r.observations as Observation[] : []
  // P11: Handle old format where stamps were stored as observations with isStamp
  const OLD_STAMP_QUOTE = /^Interview state:\s*(\w+)$/
  const STAMP_TYPES = new Set(['respondingAt', 'rulesExplainedAt', 'boundaryStatedAt', 'askedToLeaveAt', 'entryDeniedAt'])
  const stamps: InterviewStamp[] = []
  const filteredObs: Observation[] = []
  for (const o of obs) {
    if ((o as any).isStamp === true) {
      const parsed = OLD_STAMP_QUOTE.exec(o.quotes?.[0] ?? '')?.[1]
      const type = (o as any).type ?? parsed
      if (type && STAMP_TYPES.has(type)) {
        stamps.push({ type: type as keyof InterviewState, at: o.at, isStamp: true })
      }
      continue
    }
    // Assign a legacy id to observations that predate stable ids (format: code-at).
    const withId: Observation = o.id ? o : { ...o, id: `${o.code}-${o.at}` }
    filteredObs.push(withId)
  }
  const interviewState = typeof r.interviewState === 'object' && r.interviewState !== null ? r.interviewState as Record<string, string> : {}
  const corrections = Array.isArray(r.corrections) ? r.corrections as Correction[] : []
  const availability = typeof r.availability === 'object' && r.availability !== null ? r.availability as StoredRisk['availability'] : undefined
  return { observations: filteredObs, stamps, interviewState, corrections, availability }
}

/**
 * Merge a fresh model pass with the existing stored observations.
 * - Sensor, resident, and helper observations are ALWAYS kept (they are not model output).
 * - Anything a helper has touched (confirmed or rejected) is kept regardless of source.
 * - A fresh model pass replaces prior transcript observations.
 * - Helper-rejected events stay rejected on every later pass.
 * P11: stamps are stored separately and always kept.
 */
export function mergeFresh(stored: StoredRisk, fresh: Observation[]): StoredRisk {
  const touchedIdxs = new Set(stored.corrections.map(c => c.idx))
  const kept: Observation[] = []

  for (const [i, o] of stored.observations.entries()) {
    // Always keep non-transcript observations (sensor, resident, helper) — they are ground truth, not model output.
    // Also keep anything a helper has explicitly touched (confirm / reject / restore).
    if (o.source !== 'transcript' || touchedIdxs.has(i)) {
      kept.push(o)
    }
  }

  // Add fresh observations from the model or keyword rules
  return {
    observations: [...kept, ...fresh],
    stamps: stored.stamps, // P11: stamps are always kept
    interviewState: stored.interviewState,
    corrections: stored.corrections,
    availability: stored.availability,
  }
}

/**
 * Apply a helper action (confirm, reject, restore, or resolve) to the stored observations.
 * Resolves the target by obsId first, then falls back to idx.
 * Returns { stored, error } — caller checks error before using stored.
 * P5: Reject marks the event as retracted; confirm marks it as confirmed by a helper; restore removes a rejection.
 * P9: Resolve marks the event as resolved (keeps points, removes floor/minScore).
 */
export function applyHelperAction(
  stored: StoredRisk,
  idx: number,
  action: 'confirm' | 'reject' | 'restore' | 'resolve',
  who: string,
  reason?: string,
  obsId?: string,
): StoredRisk & { _error?: string } {
  const obs = [...stored.observations]

  // Prefer obsId lookup (stable across reorders); fall back to positional idx.
  let resolvedIdx = idx
  if (obsId) {
    const found = obs.findIndex(o => o.id === obsId)
    if (found !== -1) resolvedIdx = found
  }

  if (resolvedIdx < 0 || resolvedIdx >= obs.length) {
    return { ...stored, _error: `observation index ${resolvedIdx} out of range (${obs.length} observations)` }
  }

  // P10: Block helper reject and resolve on resident-sourced observations
  const target = obs[resolvedIdx]
  if (target.source === 'resident' && (action === 'reject' || action === 'resolve')) {
    return { ...stored, _error: 'Cannot reject or resolve resident-sourced observations' }
  }

  if (action === 'reject') {
    obs[resolvedIdx] = { ...obs[resolvedIdx], retracted: true }
  } else if (action === 'confirm') {
    // Save the pre-confirm state so restore can undo it exactly.
    const current = obs[resolvedIdx]
    obs[resolvedIdx] = {
      ...current,
      state: 'confirmed',
      source: 'helper',
      _before: current._before ?? { state: current.state, source: current.source },
    }
  } else if (action === 'restore') {
    // Restore removes retraction AND reverts a prior confirm back to the saved pre-confirm state.
    const current = obs[resolvedIdx]
    const { retracted: _r, _before, resolvedAt: _ra, resolvedBy: _rb, ...rest } = current as Observation & { retracted?: boolean; resolvedAt?: string; resolvedBy?: string }
    if (_before) {
      obs[resolvedIdx] = { ...rest, state: _before.state, source: _before.source }
    } else {
      obs[resolvedIdx] = rest
    }
  } else if (action === 'resolve') {
    // P9: Mark as resolved - keeps points but removes floor/minScore
    const current = obs[resolvedIdx]
    obs[resolvedIdx] = {
      ...current,
      resolvedAt: new Date().toISOString(),
      resolvedBy: who,
    }
  }

  return {
    observations: obs,
    stamps: stored.stamps,
    interviewState: stored.interviewState,
    corrections: [...stored.corrections, { idx: resolvedIdx, obsId: obs[resolvedIdx].id, action, at: new Date().toISOString(), who, reason }],
    availability: stored.availability,
  }
}
