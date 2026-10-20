/**
 * Structured turn persistence (WP7).
 * Provides typed interfaces for turn records, claims, evidence, and verification results.
 */

import type { Slot } from './plan'
import type { Observation } from '@/lib/doorstep/riskRules'

/** Evidence extracted from a visitor's answer */
export interface EvidenceItem {
  id: string
  eventCode: string
  quote: string
  source: 'transcript' | 'model' | 'rule'
  state: 'confirmed' | 'uncertain' | 'unavailable'
  transcriptQuality?: 'high' | 'medium' | 'low'
  timestamp: number
}

/** Claim made by the visitor */
export interface Claim {
  type: 'organisation' | 'identity' | 'phone' | 'reference' | 'purpose' | 'relation'
  value: string
  source: 'visitor' | 'document' | 'camera'
  extractedAt: number
}

/** Objective being pursued in the interview */
export interface ObjectiveUpdate {
  slot: Slot
  status: 'missing' | 'vague' | 'specific' | 'refused'
  askedCount: number
}

/** Independent verification result */
export interface VerificationResult {
  status: 'verified' | 'not_found' | 'unavailable'
  source?: string
  checkedAt: number
  explanation: string
}

/** Single turn in the interrogation */
export interface TurnRecord {
  turnIndex: number
  questionSpoken: string
  selectedObjective: Slot | null
  transcript: string
  transcriptQuality?: 'high' | 'medium' | 'low'
  timestamp: number
  claims: Claim[]
  evidence: EvidenceItem[]
  objectiveUpdates: ObjectiveUpdate[]
  decision: string
  reason: string
  verification?: VerificationResult
  riskScore: number
  controlMode: string
}

/**
 * Backwards-compatible reader for old turn records
 * Converts unstructured InterrogationTurn[] to structured TurnRecord[]
 */
export function turnRecordFromLegacy(legacy: any, index: number): TurnRecord {
  return {
    turnIndex: index,
    questionSpoken: legacy.question || '',
    selectedObjective: legacy.focus || null,
    transcript: legacy.transcript || '',
    transcriptQuality: undefined,
    timestamp: legacy.timestamp || Date.now(),
    claims: [],
    evidence: [],
    objectiveUpdates: [],
    decision: legacy.modelFailed ? 'model_failed' : 'continued',
    reason: '',
    riskScore: 0,
    controlMode: 'ai_leads',
  }
}

/**
 * Serialize TurnRecord for storage in the JSON field
 */
export function serializeTurnRecord(record: TurnRecord): any {
  return {
    question: record.questionSpoken,
    transcript: record.transcript,
    timestamp: record.timestamp,
    next: null, // Will be set by caller
    obs: {}, // Backwards compatibility
    focus: record.selectedObjective,
    modelFailed: false,
    // Store structured data as additional fields
    _structured: {
      claims: record.claims,
      evidence: record.evidence,
      objectiveUpdates: record.objectiveUpdates,
      decision: record.decision,
      reason: record.reason,
      verification: record.verification,
      riskScore: record.riskScore,
      controlMode: record.controlMode,
      transcriptQuality: record.transcriptQuality,
    },
  }
}

/**
 * Deserialize TurnRecord from stored JSON
 */
export function deserializeTurnRecord(stored: any, index: number): TurnRecord {
  if (stored._structured) {
    return {
      turnIndex: index,
      questionSpoken: stored.question || '',
      selectedObjective: stored.focus || null,
      transcript: stored.transcript || '',
      transcriptQuality: stored._structured.transcriptQuality,
      timestamp: stored.timestamp || Date.now(),
      claims: stored._structured.claims || [],
      evidence: stored._structured.evidence || [],
      objectiveUpdates: stored._structured.objectiveUpdates || [],
      decision: stored._structured.decision || 'continued',
      reason: stored._structured.reason || '',
      verification: stored._structured.verification,
      riskScore: stored._structured.riskScore || 0,
      controlMode: stored._structured.controlMode || 'ai_leads',
    }
  }
  return turnRecordFromLegacy(stored, index)
}
