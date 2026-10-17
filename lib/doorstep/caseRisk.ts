/**
 * Stored risk observations: merge fresh model passes with the existing store, apply helper actions.
 * Pure functions. No database access. The database layer is in caseRiskStore.ts.
 *
 * Round 2 patches: #2 (model events never scored), #13 (reject uses wrong index)
 */
import type { Observation, ControlMode, RiskScore, LedgerEntry } from './riskRules'

/**
 * The structure stored in Case.riskObservations (JSON column).
 * Round 2: observations array replaces the old ledger array. The ledger is computed from observations.
 */
export interface StoredRisk {
  /** All observations collected for this case, in the order they arrived. */
  observations: Observation[]
  /** Interview state stamps (timestamps of key interview milestones). */
  interviewState: Record<string, string>
  /** Helper corrections: index-based confirm/reject actions. */
  corrections: Correction[]
}

export interface Correction {
  /** Position in the observations array this correction applies to. */
  idx: number
  /** Action taken. */
  action: 'confirm' | 'reject'
  /** ISO timestamp when the helper acted. */
  at: string
}

/**
 * Read the stored observations. The old format (a ledger array) reads as empty.
 * This allows a safe migration without breaking existing cases.
 */
export function readStored(raw: unknown): StoredRisk {
  if (!raw || typeof raw !== 'object') return { observations: [], interviewState: {}, corrections: [] }
  const r = raw as Record<string, unknown>
  if (Array.isArray(r)) return { observations: [], interviewState: {}, corrections: [] } // Old ledger format
  const obs = Array.isArray(r.observations) ? r.observations as Observation[] : []
  const interviewState = typeof r.interviewState === 'object' && r.interviewState !== null ? r.interviewState as Record<string, string> : {}
  const corrections = Array.isArray(r.corrections) ? r.corrections as Correction[] : []
  return { observations: obs, interviewState, corrections }
}

/**
 * Merge a fresh model pass with the existing stored observations.
 * - Knock events, SOS, interview stamps, and anything a helper touched are kept.
 * - A fresh model pass can add new observations from the model or keyword rules.
 * - Helper-rejected events stay rejected on every later pass.
 */
export function mergeFresh(stored: StoredRisk, fresh: Observation[]): StoredRisk {
  const touchedIdxs = new Set(stored.corrections.map(c => c.idx))
  const kept: Observation[] = []

  for (const [i, o] of stored.observations.entries()) {
    // Keep knocks, SOS, stamps, and anything a helper touched
    if (o.code === 'extra_knock' || o.code === 'forced_entry_or_assault' || o.isStamp || touchedIdxs.has(i)) {
      kept.push(o)
    }
  }

  // Add fresh observations from the model or keyword rules
  return {
    observations: [...kept, ...fresh],
    interviewState: stored.interviewState,
    corrections: stored.corrections,
  }
}

/**
 * Apply a helper action (confirm or reject) to the stored observations.
 * Reject marks the event as retracted; confirm marks it as confirmed by a helper.
 */
export function applyHelperAction(stored: StoredRisk, idx: number, action: 'confirm' | 'reject'): StoredRisk {
  const obs = [...stored.observations]
  if (idx < 0 || idx >= obs.length) return stored

  if (action === 'reject') {
    obs[idx] = { ...obs[idx], retracted: true }
  } else {
    obs[idx] = { ...obs[idx], state: 'confirmed', source: 'helper' }
  }

  return {
    observations: obs,
    interviewState: stored.interviewState,
    corrections: [...stored.corrections, { idx, action, at: new Date().toISOString() }],
  }
}
