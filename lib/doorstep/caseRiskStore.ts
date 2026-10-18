/**
 * Single risk writer: the only code that writes riskScore, riskLedger, controlMode, riskLevel or riskObservations.
 * Round 2 patch #3: the interviewer no longer overwrites the observation store with the ledger array.
 *
 * applyRiskEdit(caseId, edit) reads the stored list, applies one edit, re-scores the whole list, and saves everything.
 * Edit kinds: 'fresh' (model pass), 'knock', 'append' (SOS or a report), 'interview' (stamp), 'helper',
 *             'availability' (camera/mic availability), 'reset' (soft-retract all observations).
 *
 * The knock window (30 s from the AI starting to respond) and the cap of 5 live here.
 *
 * P7: Timer values from Section 5.3 are implemented (60s/180s/300s at score 0, shrinking to 10s/45s/90s at score 100).
 */
import { getDb } from '@/lib/db/client'
import { scoreObservations, modeRank, newObsId, type Observation, type RiskScore, type InterviewState, type InterviewStamp, type ControlMode } from './riskRules'
import { readStored, mergeFresh, applyHelperAction, type StoredRisk, type Correction } from './caseRisk'
import { createInterviewStamp } from './riskRules'
import { DEFAULT_ESCALATION_SECONDS } from '@/lib/doorbell/config'

/** The kinds of edits that can be applied to a case's risk observations. */
export type RiskEdit =
  | { kind: 'fresh'; observations: Observation[]; interviewState?: InterviewState }
  | { kind: 'knock'; at: string }
  | { kind: 'append'; observation: Observation }
  | { kind: 'interview'; stampType: keyof InterviewState; at: string }
  | { kind: 'helper'; idx: number; obsId?: string; action: 'confirm' | 'reject' | 'restore'; who: string; reason?: string }
  | { kind: 'availability'; device: 'camera' | 'mic'; available: boolean; since: string; reason?: string }
  | { kind: 'reset'; who: string; reason: string }

/**
 * Apply a single edit to a case's risk observations and re-score.
 * This is the ONLY code that writes riskScore, riskLedger, controlMode, riskLevel or riskObservations.
 */
export async function applyRiskEdit(caseId: string, edit: RiskEdit): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = await getDb().case.findUnique({
    where: { id: caseId },
    select: { id: true, riskObservations: true, householdId: true, controlMode: true, deadlineAt: true, unconfirmedAlertedAt: true },
  })
  if (!c) return { ok: false, error: 'case not found' }

  // Read the current stored observations. The old format (ledger array) reads as empty.
  const stored = readStored(c.riskObservations as unknown)

  let newStored: StoredRisk

  switch (edit.kind) {
    case 'fresh': {
      // A fresh model pass merges with the existing observations, keeping non-transcript sources, stamps, and helper-touched events.
      newStored = mergeFresh(stored, edit.observations)
      if (edit.interviewState) {
        newStored.interviewState = { ...stored.interviewState, ...edit.interviewState }
      }
      break
    }

    case 'knock': {
      // A knock is only counted if it occurs within 30 seconds of the AI starting to respond.
      const respondingAt = stored.interviewState.respondingAt
      if (!respondingAt) return { ok: true } // No AI response yet, silently ignore knock
      const elapsed = new Date(edit.at).getTime() - new Date(respondingAt).getTime()
      if (elapsed > 30000) return { ok: true } // Outside the 30-second window

      // Count existing knocks, cap at 5
      const existingKnocks = stored.observations.filter(o => o.code === 'extra_knock').length
      if (existingKnocks >= 5) return { ok: true }

      newStored = {
        ...stored,
        observations: [
          ...stored.observations,
          {
            id: newObsId(),
            code: 'extra_knock',
            at: edit.at,
            quotes: ['Repeated button press'],
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
      // Append a new observation (SOS or a report from a helper). Assign id if missing.
      const obs: Observation = edit.observation.id ? edit.observation : { ...edit.observation, id: newObsId() }
      newStored = {
        ...stored,
        observations: [...stored.observations, obs],
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
      // P5: Apply a helper confirm, reject, or restore action with audit trail.
      const result = applyHelperAction(stored, edit.idx, edit.action, edit.who, edit.reason, edit.obsId)
      if (result._error) return { ok: false, error: result._error }
      newStored = result
      break
    }

    case 'availability': {
      // Mark a device (camera or mic) as available or unavailable.
      // This writes no points and does not lower the mode.
      const prevAvailability = stored.availability ?? {}
      if (edit.available) {
        // Coming back online: clear the marker.
        const updated = { ...prevAvailability }
        delete updated[edit.device]
        newStored = { ...stored, availability: Object.keys(updated).length ? updated : undefined }
      } else {
        newStored = {
          ...stored,
          availability: {
            ...prevAvailability,
            [edit.device]: { since: edit.since, reason: edit.reason ?? 'unavailable' },
          },
        }
      }
      break
    }

    case 'reset': {
      // Soft-retract all observations. Score drops to 0. Audit trail is preserved.
      // emergencyAlertedAt is NOT touched — the helper must explicitly decide what to do.
      const retractAll = stored.observations.map(o => ({ ...o, retracted: true }))
      const resetCorrection: Correction = {
        idx: -1, // sentinel: applies to all
        action: 'reject' as const,
        at: new Date().toISOString(),
        who: edit.who,
        reason: `RESET: ${edit.reason}`,
      }
      newStored = {
        ...stored,
        observations: retractAll,
        corrections: [...stored.corrections, resetCorrection],
      }
      break
    }

    default:
      return { ok: false, error: 'unknown edit kind' }
  }

  // Re-score the entire observation list.
  // Transcript-source observations carry their own segment field (saved on first pass), so passing '' here
  // is safe: scoreObservations prefers o.segment over ctx.transcript for quote grounding.
  const risk = scoreObservations(newStored.observations, {
    transcript: '',
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

  // G1c: Fire emergency alert if case newly became emergency
  const prevMode = (c.controlMode as ControlMode | null) ?? null
  const becameEmergency = risk.minMode === 'emergency' && prevMode !== 'emergency'
  const rose = prevMode !== null && modeRank(risk.minMode) > modeRank(prevMode)

  if (becameEmergency) {
    // P7: Emergency has no acknowledgement timer; everyone is alerted now, deadline left alone
    const { alertEmergency } = await import('@/lib/doorbell/store')
    await alertEmergency(c.householdId, caseId)
  } else if (rose) {
    // P7: Shorten deadline for non-emergency mode rises using score-based timer (compare-and-set to avoid race conditions)
    const now = Date.now()
    // Compute new timer based on risk score (DEFAULT_ESCALATION_SECONDS at 0 → 10s at 100, floor 10s)
    const scoreRatio = Math.min(risk.score, 100) / 100
    const baseSec = DEFAULT_ESCALATION_SECONDS // Default acknowledgement timer at score 0
    const minSec = 10 // Floor
    // Linear interpolation: 60s at score 0, 10s at score 100
    const newTimerSec = Math.max(minSec, Math.floor(baseSec - (baseSec - minSec) * scoreRatio))
    // Set deadline to now + new timer, but never extend it
    const target = now + newTimerSec * 1000
    if (target < c.deadlineAt.getTime()) {
      // Compare-and-set: only write if nobody changed the deadline since we read it.
      await getDb().case.updateMany({
        where: { id: caseId, deadlineAt: c.deadlineAt },
        data: { deadlineAt: new Date(target) },
      })
    }
  }

  // G4: Spec 4.3 – uncertain forced_entry_or_assault (camera model description alone) triggers an unconfirmed alert.
  // immediate_threat at uncertain does NOT trigger G4 — it only raises the floor to helper_leads.
  const hasUncertainForcedEntry = risk.ledger.some(
    e => e.code === 'forced_entry_or_assault' && e.state === 'uncertain'
  )
  if (hasUncertainForcedEntry && !c.unconfirmedAlertedAt) {
    const { alertUnconfirmedEmergency } = await import('@/lib/doorbell/store')
    await alertUnconfirmedEmergency(c.householdId, caseId)
  }

  return { ok: true }
}
