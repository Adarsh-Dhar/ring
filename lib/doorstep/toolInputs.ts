/**
 * AI tool input validation (spec 9.1).
 *
 * - report_observation: refuses score/floor/mode/timer/permission fields; a camera report or an ungrounded quote is never "confirmed"
 * - summarize_evidence: Observed / Inferred / Unknown, speech labelled as a claim
 */

import type { Observation, Behaviour } from './riskRules'
import { newObsId } from './riskRules'

export interface ValidationResult {
  valid: boolean
  reason?: string
  observation?: Observation
}

/**
 * Validate report_observation input.
 *
 * Refuses:
 * - score, floor, mode, timer, permission fields (AI cannot set these)
 * - Camera reports are never "confirmed" (always uncertain)
 * - Ungrounded quotes are never "confirmed"
 */
export function validateObservationInput(args: any): ValidationResult {
  if (!args || typeof args !== 'object') {
    return { valid: false, reason: 'Invalid input: not an object' }
  }

  const { code, quote, source, state } = args

  // Required fields
  if (!code || typeof code !== 'string') {
    return { valid: false, reason: 'Missing or invalid code' }
  }

  if (!quote || typeof quote !== 'string') {
    return { valid: false, reason: 'Missing or invalid quote' }
  }

  if (!source || typeof source !== 'string') {
    return { valid: false, reason: 'Missing or invalid source' }
  }

  // Refuse fields AI cannot set
  const forbidden = ['score', 'floor', 'mode', 'timer', 'permission']
  for (const field of forbidden) {
    if (field in args) {
      return { valid: false, reason: `AI cannot set field: ${field}` }
    }
  }

  // Determine evidence state
  let evidenceState: 'confirmed' | 'uncertain' | 'unavailable' = state ?? 'uncertain'

  // Camera reports are never confirmed
  if (source === 'camera' || source === 'sensor') {
    evidenceState = 'uncertain'
  }

  // Ungrounded quotes (no actual transcript reference) are never confirmed
  if (source === 'transcript' && (!quote || quote.trim().length === 0)) {
    evidenceState = 'uncertain'
  }

  // Build observation
  const observation: Observation = {
    id: newObsId(),
    code: code as Behaviour,
    at: new Date().toISOString(),
    quotes: [quote],
    source: source as 'transcript' | 'sensor' | 'camera' | 'resident' | 'helper',
    state: evidenceState,
    points: 0, // AI never sets points
  }

  return { valid: true, observation }
}

/**
 * Build evidence summary for summarize_evidence.
 *
 * Returns Observed / Inferred / Unknown categorization.
 * Speech is labelled as a claim (not fact).
 */
export interface EvidenceSummary {
  observed: Observation[]
  inferred: Observation[]
  unknown: Observation[]
  claims: string[] // Speech quotes labelled as claims
}

export async function buildEvidenceSummary(caseId: string): Promise<EvidenceSummary> {
  const { getDb } = await import('@/lib/db/client')
  const c = await getDb().case.findUnique({
    where: { id: caseId },
    select: { riskObservations: true },
  })

  if (!c) {
    return { observed: [], inferred: [], unknown: [], claims: [] }
  }

  const { readStored } = await import('./caseRisk')
  const stored = readStored(c.riskObservations as unknown)

  const observed: Observation[] = []
  const inferred: Observation[] = []
  const unknown: Observation[] = []
  const claims: string[] = []

  for (const obs of stored.observations) {
    if (obs.state === 'confirmed') {
      observed.push(obs)
    } else if (obs.state === 'uncertain') {
      inferred.push(obs)
    } else {
      unknown.push(obs)
    }

    // Speech is labelled as a claim
    if (obs.source === 'transcript') {
      claims.push(...obs.quotes)
    }
  }

  return { observed, inferred, unknown, claims }
}
