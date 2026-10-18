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
}

export interface Correction {
  /** Position in the observations array this correction applies to. */
  idx: number
  /** Action taken. */
  action: 'confirm' | 'reject' | 'restore'
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
  const STAMP_TYPES = new Set(['respondingAt', 'rulesExplainedAt', 'boundaryStatedAt', 'askedToLeaveAt'])
  const stamps: InterviewStamp[] = []
  const filteredObs: Observation[] = []
  for (const o of obs) {
    if ((o as any).isStamp === true) {
      const parsed = OLD_STAMP_QUOTE.exec(o.quotes?.[0] ?? '')?.[1]
      const type = (o as any).type ?? parsed
      if (type && STAMP_TYPES.has(type)) {
        stamps.push({ type: type as 'respondingAt' | 'rulesExplainedAt' | 'boundaryStatedAt' | 'askedToLeaveAt', at: o.at, isStamp: true })
      }
      continue
    }
    filteredObs.push(o)
  }
  const interviewState = typeof r.interviewState === 'object' && r.interviewState !== null ? r.interviewState as Record<string, string> : {}
  const corrections = Array.isArray(r.corrections) ? r.corrections as Correction[] : []
  return { observations: filteredObs, stamps, interviewState, corrections }
}

/**
 * Merge a fresh model pass with the existing stored observations.
 * - Knock events, SOS, interview stamps, and anything a helper touched are kept.
 * - A fresh model pass can add new observations from the model or keyword rules.
 * - Helper-rejected events stay rejected on every later pass.
 * P11: stamps are stored separately and always kept.
 */
export function mergeFresh(stored: StoredRisk, fresh: Observation[]): StoredRisk {
  const touchedIdxs = new Set(stored.corrections.map(c => c.idx))
  const kept: Observation[] = []

  for (const [i, o] of stored.observations.entries()) {
    // Keep knocks, SOS, and anything a helper touched
    if (o.code === 'extra_knock' || o.code === 'forced_entry_or_assault' || touchedIdxs.has(i)) {
      kept.push(o)
    }
  }

  // Add fresh observations from the model or keyword rules
  return {
    observations: [...kept, ...fresh],
    stamps: stored.stamps, // P11: stamps are always kept
    interviewState: stored.interviewState,
    corrections: stored.corrections,
  }
}

/**
 * Apply a helper action (confirm, reject, or restore) to the stored observations.
 * P5: Reject marks the event as retracted; confirm marks it as confirmed by a helper; restore removes a rejection.
 */
export function applyHelperAction(stored: StoredRisk, idx: number, action: 'confirm' | 'reject' | 'restore', who: string, reason?: string): StoredRisk {
  const obs = [...stored.observations]
  if (idx < 0 || idx >= obs.length) return stored

  if (action === 'reject') {
    obs[idx] = { ...obs[idx], retracted: true }
  } else if (action === 'confirm') {
    obs[idx] = { ...obs[idx], state: 'confirmed', source: 'helper' }
  } else if (action === 'restore') {
    // P5: Restore removes the retraction, reverting to original state
    const { retracted, ...rest } = obs[idx]
    obs[idx] = rest
  }

  return {
    observations: obs,
    stamps: stored.stamps,
    interviewState: stored.interviewState,
    corrections: [...stored.corrections, { idx, action, at: new Date().toISOString(), who, reason }],
  }
}
