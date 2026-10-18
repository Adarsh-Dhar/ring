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
import { scoreObservations, modeRank, type Observation, type RiskScore, type InterviewState, type InterviewStamp, type ControlMode } from './riskRules'
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

  await getDb().case.update({
    where: { id: caseId },
    data: {
      riskScore: risk.score,
      riskLedger: risk.ledger as any,
      controlMode: risk.minMode,
      riskLevel: risk.score >= 80 ? 'high' : risk.score >= 50 ? 'medium' : risk.score >= 20 ? 'low' : 'none',
      riskObservations: newStored as any,
    },
  })

  // P9: Shorten deadline when control mode rises (compare-and-set to avoid race conditions)
  const prevMode = (c.controlMode as ControlMode | null) ?? null
  const rose = prevMode !== null && modeRank(risk.minMode) > modeRank(prevMode)

  if (rose) {
    const now = Date.now()
    const remaining = Math.max(0, c.deadlineAt.getTime() - now)
    // PLACEHOLDER until Section 5.3: emergency is due now, other rises halve what is left.
    const target = risk.minMode === 'emergency' ? now : now + Math.floor(remaining * 0.5)
    if (target < c.deadlineAt.getTime()) {
      // Compare-and-set: only write if nobody changed the deadline since we read it.
      await getDb().case.updateMany({
        where: { id: caseId, deadlineAt: c.deadlineAt },
        data: { deadlineAt: new Date(target) },
      })
    }
  }
}
