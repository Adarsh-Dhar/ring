/**
 * Single risk writer: the only code that writes riskScore, riskLedger, controlMode, riskLevel or riskObservations.
 * Round 2 patch #3: the interviewer no longer overwrites the observation store with the ledger array.
 *
 * applyRiskEdit(caseId, edit) reads the stored list, applies one edit, re-scores the whole list, and saves everything.
 * Edit kinds: 'fresh' (model pass), 'knock', 'append' (SOS or a report), 'interview' (stamp), 'helper'.
 *
 * The knock window (30 s from the AI starting to respond) and the cap of 5 live here.
 */
import { getDb } from '@/lib/db/client'
import { scoreObservations, type Observation, type RiskScore, type InterviewState, type InterviewStamp, type ControlMode } from './riskRules'
import { readStored, mergeFresh, applyHelperAction, type StoredRisk, type Correction } from './caseRisk'
import { createInterviewStamp } from './riskRules'

/** The kinds of edits that can be applied to a case's risk observations. */
export type RiskEdit =
  | { kind: 'fresh'; observations: Observation[]; interviewState?: InterviewState }
  | { kind: 'knock'; at: string }
  | { kind: 'append'; observation: Observation }
  | { kind: 'interview'; stampType: keyof InterviewState; at: string }
  | { kind: 'helper'; idx: number; action: 'confirm' | 'reject' }

/**
 * Apply a single edit to a case's risk observations and re-score.
 * This is the ONLY code that writes riskScore, riskLedger, controlMode, riskLevel or riskObservations.
 */
export async function applyRiskEdit(caseId: string, edit: RiskEdit): Promise<void> {
  const c = await getDb().case.findUnique({
    where: { id: caseId },
    select: { id: true, riskObservations: true, householdId: true, controlMode: true, deadlineAt: true },
  })
  if (!c) return

  // Read the current stored observations. The old format (ledger array) reads as empty.
  const stored = readStored(c.riskObservations as unknown)

  let newStored: StoredRisk

  switch (edit.kind) {
    case 'fresh': {
      // A fresh model pass merges with the existing observations, keeping knocks, SOS, stamps, and helper-touched events.
      newStored = mergeFresh(stored, edit.observations)
      if (edit.interviewState) {
        newStored.interviewState = { ...stored.interviewState, ...edit.interviewState }
      }
      break
    }

    case 'knock': {
      // A knock is only counted if it occurs within 30 seconds of the AI starting to respond.
      const respondingAt = stored.interviewState.respondingAt
      if (!respondingAt) return // No AI response yet, ignore knock
      const elapsed = new Date(edit.at).getTime() - new Date(respondingAt).getTime()
      if (elapsed > 30000) return // Outside the 30-second window

      // Count existing knocks, cap at 5
      const existingKnocks = stored.observations.filter(o => o.code === 'extra_knock').length
      if (existingKnocks >= 5) return

      newStored = {
        ...stored,
        observations: [
          ...stored.observations,
          {
            code: 'extra_knock',
            at: edit.at,
            quotes: [],
            source: 'sensor',
            state: 'confirmed',
            points: 0,
            debug: { eventId: `knock-${edit.at}` },
          },
        ],
      }
      break
    }

    case 'append': {
      // Append a new observation (SOS or a report from a helper).
      newStored = {
        ...stored,
        observations: [...stored.observations, edit.observation],
      }
      break
    }

    case 'interview': {
      // Add an interview state stamp.
      const stamp = createInterviewStamp(edit.stampType, edit.at)
      newStored = {
        ...stored,
        interviewState: { ...stored.interviewState, [edit.stampType]: edit.at },
        stamps: [...stored.stamps, stamp],
      }
      break
    }

    case 'helper': {
      // Apply a helper confirm or reject action.
      newStored = applyHelperAction(stored, edit.idx, edit.action)
      break
    }

    default:
      return
  }

  // Re-score the entire observation list.
  const risk = scoreObservations(newStored.observations, {
    transcript: '', // The transcript is not stored; only observations are.
    interviewState: newStored.interviewState,
  })

  // P9: Shorten deadline when control mode rises (compare-and-set to avoid race conditions)
  const prevMode = (c as any).controlMode as ControlMode | null
  const newMode = risk.minMode
  let newDeadline: number | undefined
  if (prevMode && newMode !== prevMode && isHigherMode(newMode, prevMode)) {
    // Mode rose: shorten the deadline proportionally
    const current = await getDb().case.findUnique({
      where: { id: caseId },
      select: { deadlineAt: true },
    })
    if (current) {
      const remainingMs = current.deadlineAt.getTime() - Date.now()
      // Emergency gets the full 30-minute window, otherwise reduce by 50%
      const reductionFactor = newMode === 'emergency' ? 1 : 0.5
      newDeadline = Date.now() + Math.floor(remainingMs * reductionFactor)
    }
  }

  // Save everything in one update.
  const updateData: any = {
    riskScore: risk.score,
    riskLedger: risk.ledger as any,
    controlMode: risk.minMode,
    riskLevel: risk.score >= 80 ? 'high' : risk.score >= 50 ? 'medium' : risk.score >= 20 ? 'low' : 'none',
    riskObservations: newStored as any,
  }
  if (newDeadline) {
    updateData.deadlineAt = new Date(newDeadline)
  }
  await getDb().case.update({
    where: { id: caseId },
    data: updateData,
  })
}

/** Helper to check if new mode is higher (more urgent) than previous mode */
function isHigherMode(newMode: ControlMode, prevMode: ControlMode): boolean {
  const modeOrder: Record<ControlMode, number> = { ai_leads: 0, helper_leads: 1, emergency: 2 }
  return modeOrder[newMode] > modeOrder[prevMode]
}
