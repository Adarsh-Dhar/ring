/**
 * Stored risk observations: merge fresh model passes with the existing store, apply helper actions.
 * Pure functions. No database access. The database layer is in caseRiskStore.ts.
 *
 * Round 2 patches: #2 (model events never scored), #13 (reject uses wrong index)
 * P11: stamps are now their own type, not observations
 */
import { isSerious, observationKey, type Observation, type ControlMode, type RiskScore, type LedgerEntry, type InterviewStamp, type InterviewState } from './riskRules'

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
  /** Section 8.2: what the resident said about the visitor. Shown to the helper, never lowers the score. */
  statements?: ResidentStatement[]
  /** Step 4: device availability (camera / mic / ai). Present when a device was unavailable during the case. */
  availability?: {
    camera?: { since: string; reason: string }
    mic?:    { since: string; reason: string }
    ai?:     { since: string; reason: string }
  }
}

/** Section 8.2: "the visitor is expected or known" is recorded as the resident's statement and does not lower the score. */
export interface ResidentStatement {
  id: string
  kind: 'expected' | 'known'
  at: string
  who: string
  note?: string
}

export interface Correction {
  /** Position in the observations array this correction applies to.
   *  @deprecated Use obsId when available. */
  idx: number
  /** Stable observation id. Preferred over idx. */
  obsId?: string
  /** Action taken. */
  action: 'confirm' | 'reject' | 'restore' | 'resolve' | 'dispute'
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
  const statements = Array.isArray(r.statements) ? r.statements as ResidentStatement[] : undefined
  return { observations: filteredObs, stamps, interviewState, corrections, availability, ...(statements ? { statements } : {}) }
}

/** True when a person has acted on this observation (retract, resolve, confirm, restore or dispute). */
function isTouched(o: Observation, correctedIds: Set<string>): boolean {
  return !!(o.id && correctedIds.has(o.id)) || !!(o.retracted || o.resolvedAt || o._before || o.disputedAt)
}

/**
 * Merge a fresh model pass with the existing stored observations.
 * - Sensor, resident, and helper observations are ALWAYS kept (they are not model output).
 * - Anything a helper has touched (confirmed, retracted, resolved, restored) is kept regardless of source.
 *   Corrections are matched by observation ID, never by array position, because positions shift on every merge.
 * - A fresh model pass replaces prior untouched transcript observations.
 * - A fresh observation that repeats a kept one (same event key) is dropped, so the next model pass cannot
 *   re-score an event a helper retracted, resolved or reset (section 8.2).
 * P11: stamps are stored separately and always kept.
 */
export function mergeFresh(stored: StoredRisk, fresh: Observation[]): StoredRisk {
  const correctedIds = new Set<string>()
  for (const c of stored.corrections) {
    const id = c.obsId ?? (c.idx >= 0 ? stored.observations[c.idx]?.id : undefined)
    if (id) correctedIds.add(id)
  }
  const kept: Observation[] = []
  for (const o of stored.observations) {
    // C-07: Treat transcript observations as append-only
    // Always keep non-transcript observations (sensor, resident, helper)
    // Keep transcript observations that are confirmed or touched by a person
    if (o.source !== 'transcript' || o.state === 'confirmed' || isTouched(o, correctedIds)) kept.push(o)
  }
  const keptKeys = new Set(kept.map(observationKey))
  const keptIds = new Set(kept.map(o => o.id).filter(Boolean))

  // Additional deduplication: for transcript observations, also check by code + normalized quote
  // This prevents the same quote from being added multiple times with different timestamps
  const keptQuoteKeys = new Set(kept.filter(o => o.source === 'transcript').map(o => `${o.code}|${o.quotes.map(q => q.toLowerCase().trim()).join('|')}`))

  const fresher = fresh.filter(o => {
    // Skip if same full observation key exists
    if (keptKeys.has(observationKey(o))) return false
    // Skip if same ID exists
    if (o.id && keptIds.has(o.id)) return false
    // For transcript observations, also skip if same code + quote exists (even with different timestamp)
    if (o.source === 'transcript') {
      const quoteKey = `${o.code}|${o.quotes.map(q => q.toLowerCase().trim()).join('|')}`
      if (keptQuoteKeys.has(quoteKey)) return false
    }
    return true
  })

  return {
    observations: [...kept, ...fresher],
    stamps: stored.stamps, // P11: stamps are always kept
    interviewState: stored.interviewState,
    corrections: stored.corrections,
    availability: stored.availability,
    ...(stored.statements ? { statements: stored.statements } : {}),
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
  // C-05: Allow reject or resolve on resident SOS observation (forced_entry_or_assault, quote "Resident SOS pressed") when helper supplies a reason
  const target = obs[resolvedIdx]
  const isResidentSOS = target.source === 'resident' &&
                       target.code === 'forced_entry_or_assault' &&
                       target.quotes.includes('Resident SOS pressed')
  if (target.source === 'resident' && (action === 'reject' || action === 'resolve') && !isResidentSOS) {
    return { ...stored, _error: 'Cannot reject or resolve resident-sourced observations' }
  }
  if (isResidentSOS && (action === 'reject' || action === 'resolve') && !reason) {
    return { ...stored, _error: 'Reason required to clear resident SOS' }
  }

  // Section 8.2: only a serious event can be resolved. Minor events end with the case.
  if (action === 'resolve' && !isSerious(target.code)) {
    return { ...stored, _error: `${target.code} is a minor event: it ends with the case and is not resolved` }
  }

  const nowIso = new Date().toISOString()
  if (action === 'reject') {
    // Section 8.2: a retraction records who, when and why. The ledger keeps the entry, marked retracted.
    obs[resolvedIdx] = { ...obs[resolvedIdx], retracted: true, retractedAt: nowIso, retractedBy: who, retractReason: reason }
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
    const { retracted: _r, retractedAt: _rt, retractedBy: _rtb, retractReason: _rtr, _before, resolvedAt: _ra, resolvedBy: _rb, ...rest } = current as Observation
    if (_before) {
      obs[resolvedIdx] = { ...rest, state: _before.state, source: _before.source }
    } else {
      obs[resolvedIdx] = rest
    }
  } else if (action === 'resolve') {
    const current = obs[resolvedIdx]
    obs[resolvedIdx] = {
      ...current,
      resolvedAt: nowIso,
      resolvedBy: who,
      ...(reason ? { resolveReason: reason } : {}),
    }
  }

  return {
    observations: obs,
    stamps: stored.stamps,
    interviewState: stored.interviewState,
    corrections: [...stored.corrections, { idx: resolvedIdx, obsId: obs[resolvedIdx].id, action, at: nowIso, who, reason }],
    availability: stored.availability,
    ...(stored.statements ? { statements: stored.statements } : {}),
  }
}

/**
 * Section 8.2: a resident can flag an observation as disputed for the helper to review.
 * This is a FLAG ONLY. It never changes the score, never retracts, and never lowers a floor.
 */
export function applyDispute(stored: StoredRisk, obsId: string, who: string, note?: string): StoredRisk & { _error?: string } {
  const i = stored.observations.findIndex(o => o.id === obsId)
  if (i === -1) return { ...stored, _error: 'observation not found' }
  const at = new Date().toISOString()
  const obs = [...stored.observations]
  obs[i] = { ...obs[i], disputedAt: at, disputedBy: who, disputeNote: note }
  return { ...stored, observations: obs, corrections: [...stored.corrections, { idx: i, obsId, action: 'dispute', at, who, reason: note }] }
}

/**
 * Section 8.2: "the visitor is expected or known" is recorded as the resident's statement and shown to the helper.
 * It does not lower the score by itself, so it is stored beside the observations and never scored.
 */
export function addResidentStatement(stored: StoredRisk, kind: 'expected' | 'known', who: string, note?: string): StoredRisk {
  const st: ResidentStatement = { id: `st-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, kind, at: new Date().toISOString(), who, note }
  return { ...stored, statements: [...(stored.statements ?? []), st] }
}

/**
 * Section 8.2: a "possible new visitor" can be split into a new case. Observations at or after `splitAtIso` move to
 * the new case. Corrections follow their observations. Stamps and interview state stay with the original, because the
 * new case starts at 0 with no interview milestones carried over.
 */
export function splitStored(stored: StoredRisk, splitAtIso: string): { keep: StoredRisk; moved: StoredRisk } {
  const cut = new Date(splitAtIso).getTime()
  const isMoved = (o: Observation) => new Date(o.at).getTime() >= cut
  const movedObs = stored.observations.filter(isMoved)
  const movedIds = new Set(movedObs.map(o => o.id))
  const keepObs = stored.observations.filter(o => !isMoved(o))
  const reindex = (list: Observation[], c: Correction): Correction => ({ ...c, idx: c.obsId ? list.findIndex(o => o.id === c.obsId) : c.idx })
  const movedCorr = stored.corrections.filter(c => c.obsId && movedIds.has(c.obsId)).map(c => reindex(movedObs, c))
  const keepCorr = stored.corrections.filter(c => !(c.obsId && movedIds.has(c.obsId))).map(c => c.obsId ? reindex(keepObs, c) : c)
  return {
    keep: { ...stored, observations: keepObs, corrections: keepCorr },
    moved: { observations: movedObs, stamps: [], interviewState: {}, corrections: movedCorr },
  }
}
