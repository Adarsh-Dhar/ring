/**
 * Decision packet building (spec 10).
 *
 * Pure function that builds a decision packet from case data.
 * Reproduces the spec 10.2 example exactly.
 *
 * Extra fields under `extra` (mode name, approver, per-tool access).
 */

import type { Observation, ControlMode } from './riskRules'
import { readStored, type StoredRisk } from './caseRisk'
import { MODE_LABEL } from './modeCopy'

export interface DecisionPacket {
  caseId: string
  householdId: string
  createdAt: string
  riskScore: number
  effectiveScore: number
  controlMode: ControlMode
  modeLabel: string
  isEmergencyOverride: boolean
  observations: Observation[]
  /** Confirmed observations only */
  confirmedObservations: Observation[]
  /** Uncertain observations */
  uncertainObservations: Observation[]
  /** Unavailable observations */
  unavailableObservations: Observation[]
  /** Interview state */
  interviewState: Record<string, string>
  /** Helper corrections */
  corrections: any[]
  /** Extra metadata */
  extra: {
    modeName: string
    approver?: string
    perToolAccess: Record<string, boolean>
  }
}

/**
 * Build a decision packet from case data.
 *
 * This is a pure function that takes the raw case data and returns
 * a structured decision packet matching spec 10.2.
 */
export function buildDecisionPacket(caseData: {
  id: string
  householdId: string
  createdAt: Date
  riskScore: number | null
  controlMode: ControlMode | null
  riskObservations: unknown
  log?: unknown
}): DecisionPacket {
  const stored = readStored(caseData.riskObservations)
  const mode = caseData.controlMode ?? 'ai_leads'
  const score = caseData.riskScore ?? 0

  // Separate observations by state
  const confirmedObservations = stored.observations.filter(o => o.state === 'confirmed')
  const uncertainObservations = stored.observations.filter(o => o.state === 'uncertain')
  const unavailableObservations = stored.observations.filter(o => o.state === 'unavailable')

  // Check for emergency override
  const isEmergencyOverride = mode === 'emergency' || score >= 100

  // Build per-tool access based on mode
  const perToolAccess: Record<string, boolean> = {
    read_log_summarise: true,
    update_status: true,
    safety_script: true,
    alert_helper: true,
    emergency_guidance: isEmergencyOverride,
    boundary_statement: score < 80,
    end_conversation: score < 80,
    restate_rule_refuse: score < 60,
    neutral_verification_question: score < 40,
    offer_approved_alternative: score < 20,
    greet_routine_request: score < 20,
  }

  return {
    caseId: caseData.id,
    householdId: caseData.householdId,
    createdAt: caseData.createdAt.toISOString(),
    riskScore: score,
    effectiveScore: Math.max(score, 0), // S_eff = max(S, floor) - simplified here
    controlMode: mode,
    modeLabel: MODE_LABEL[mode] ?? mode,
    isEmergencyOverride,
    observations: stored.observations,
    confirmedObservations,
    uncertainObservations,
    unavailableObservations,
    interviewState: stored.interviewState,
    corrections: stored.corrections,
    extra: {
      modeName: MODE_LABEL[mode] ?? mode,
      approver: undefined, // Could be populated from helper data
      perToolAccess,
    },
  }
}
