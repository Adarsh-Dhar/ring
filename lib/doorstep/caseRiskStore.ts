/**
 * Single risk writer: the only code that writes riskScore, riskLedger, controlMode, riskLevel or riskObservations.
 * Round 2 patch #3: the interviewer no longer overwrites the observation store with the ledger array.
 *
 * applyRiskEdit(caseId, edit) reads the stored list, applies one edit, re-scores the whole list, and saves everything.
 * Edit kinds: 'fresh' (model pass), 'knock', 'append' (SOS or a report), 'interview' (stamp), 'helper',
 *             'availability' (camera/mic availability), 'reset' (soft-retract all observations),
 *             'dispute' (resident flag, never scores), 'statement' (resident says expected/known, never scores),
 *             'replace' (swap the stored observations, used when a case is split).
 *
 * Section 8: the lifecycle state is derived and saved in the same write as the score. A closed case refuses new events.
 * A case whose visitor has left ignores late model passes and knocks (score frozen); a new report reopens it and flags
 * "possible new visitor".
 *
 * The knock window (30 s from the AI starting to respond) and the cap of 5 live here.
 *
 * Timers follow spec 5.3: risk-decision 120 - S_eff, takeover min(120 - S_eff, 60), approval set by the resident.
 * Only the section 7.2 no-response timer keeps its own curve (NO_RESPONSE_CURVE).
 *
 * Section 7.4: mode-rise notifications create risk-decision or takeover requests when S_eff rises.
 */
import { getDb } from '@/lib/db/client'
import { scoreObservations, riskLabelFor, modeRank, newObsId, deriveLifecycleState, type Observation, type RiskScore, type InterviewState, type InterviewStamp, type ControlMode } from './riskRules'
import { readStored, mergeFresh, applyHelperAction, applyDispute, addResidentStatement, type StoredRisk, type Correction } from './caseRisk'
import { logCorrectionLabel, labelActionFor } from './correctionLabels'
import { hasPendingHelperRequest } from './caseLifecycle'
import { createInterviewStamp } from './riskRules'
import { effectiveScore, effectiveModeFor, MODE_FLOOR_SCORE, activeTimer, timersFor, riskDecisionNeeded } from './collaborationController'
import { createHelperRequest, getLatestRequest, type HelperRequestKind } from './helperRequests'
import { getApprovedMemberships } from '@/lib/db/memberships'
import { buildHelperRequest, formatPushNotification, formatSms } from './requestContent'
import { contactHelper } from './contactLog'
import { getPreferences } from '@/lib/db/preferences'
import { reportError } from '@/lib/errors'
import { shortenDeadline } from './deadline'

/** The kinds of edits that can be applied to a case's risk observations. */
export type RiskEdit =
  | { kind: 'fresh'; observations: Observation[]; interviewState?: InterviewState }
  | { kind: 'knock'; at: string }
  | { kind: 'append'; observation: Observation }
  | { kind: 'interview'; stampType: keyof InterviewState; at: string }
  | { kind: 'helper'; idx: number; obsId?: string; action: 'confirm' | 'reject' | 'restore' | 'resolve'; who: string; reason?: string }
  | { kind: 'availability'; device: 'camera' | 'mic'; available: boolean; since: string; reason?: string }
  | { kind: 'reset'; who: string; reason: string }
  | { kind: 'dispute'; obsId: string; who: string; note?: string }
  | { kind: 'statement'; statementKind: 'expected' | 'known'; who: string; note?: string }
  | { kind: 'replace'; stored: StoredRisk }

/** Edits that are a new EVENT at the door (as opposed to a correction by a person). */
const EVENT_KINDS = new Set<RiskEdit['kind']>(['fresh', 'knock', 'append', 'interview'])

interface RiseCtx {
  caseId: string
  householdId: string
  prevMode: ControlMode | null
  prevEff: number
  eff: number
  minMode: ControlMode
  observations: Observation[]
}

/**
 * Section 7.4 step 4: notify helpers when the mode rises (any mode change, or reaching M2/M3).
 * Creates risk-decision or takeover requests. createHelperRequest deduplicates, so a helper with a live request
 * of the same kind is not asked twice.
 */
export async function notifyModeRise({ caseId, householdId, prevMode, prevEff, eff, minMode, observations }: RiseCtx): Promise<void> {
  const newModeRank = modeRank(minMode)
  const oldModeRank = modeRank(prevMode ?? 'ai_leads')
  // Trigger on any mode rise
  if (newModeRank > oldModeRank) {
    const kind: HelperRequestKind = newModeRank >= 3 ? 'takeover' : 'risk_decision'
    const memberships = await getApprovedMemberships(householdId)
    const prefs = await getPreferences(householdId)

    for (const m of memberships) {
      // Deduplicate: check if a request of this kind already exists for this membership
      const existing = await getLatestRequest(caseId, m.id, kind)
      if (existing && existing.state !== 'timed_out' && existing.state !== 'declined') {
        continue // Skip if a non-terminal request already exists
      }

      // Create the request
      const created = await createHelperRequest({
        caseId,
        membershipId: m.id,
        kind,
        snapshot: { effectiveScore: eff, mode: minMode },
      })
      if (!created) continue // lost a race with another writer: the request already exists

      // Build and send notification
      const content = buildHelperRequest(
        observations,
        minMode,
        eff,
        undefined, // noticeStatus
        prefs,
        undefined,
        caseId
      )
      const pushNotif = formatPushNotification(content)
      const smsBody = formatSms(content)

      await contactHelper(caseId, m.id, { push: pushNotif, sms: smsBody }, created.id)
    }
  }
}

/**
 * Apply a single edit to a case's risk observations and re-score.
 * This is the ONLY code that writes riskScore, riskLedger, controlMode, riskLevel or riskObservations.
 *
 * RISK_SHADOW=1 stores the score without driving the controller or sending alerts (P16 shadow mode).
 */
export async function applyRiskEdit(caseId: string, edit: RiskEdit): Promise<{ ok: true } | { ok: false; error: string }> {
  const SHADOW = process.env.RISK_SHADOW === '1'
  const c = await getDb().case.findUnique({
    where: { id: caseId },
    select: { id: true, riskObservations: true, householdId: true, controlMode: true, riskScore: true, lastEventAt: true, deadlineAt: true, unconfirmedAlertedAt: true, urgentAlertedAt: true, lifecycle: true, visitorLeftAt: true, closedAt: true, possibleNewVisitorAt: true, emergencyAlertedAt: true },
  })
  if (!c) return { ok: false, error: 'case not found' }

  // Section 8.2: a closed case takes no new events. The next event opens a new case at 0 (points never carry over).
  if (c.closedAt && EVENT_KINDS.has(edit.kind)) return { ok: false, error: 'case is closed' }
  // Section 8.1: once the visitor has left the score is frozen, so a late model pass or knock changes nothing.
  if (c.visitorLeftAt && (edit.kind === 'fresh' || edit.kind === 'knock')) return { ok: true }

  // Read the current stored observations. The old format (ledger array) reads as empty.
  const stored = readStored(c.riskObservations as unknown)

  let newStored: StoredRisk
  let label: Parameters<typeof logCorrectionLabel>[0] | null = null

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
      // Add an interview state stamp. First write wins: replaying a line must not move the 30 s knock window
      // or the entry-denied time that sensor events are compared against.
      if (stored.interviewState[edit.stampType]) return { ok: true }
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
      const target = result.observations.find(o => o.id === result.corrections[result.corrections.length - 1]?.obsId)
      label = { householdId: c.householdId, caseId, obsId: target?.id, code: target?.code, action: labelActionFor(edit.action), actorRole: 'helper', actorId: edit.who, reason: edit.reason }
      break
    }

    case 'dispute': {
      // Section 8.2: a resident flag for the helper to review. The score does not change.
      const result = applyDispute(stored, edit.obsId, edit.who, edit.note)
      if (result._error) return { ok: false, error: result._error }
      newStored = result
      const target = result.observations.find(o => o.id === edit.obsId)
      label = { householdId: c.householdId, caseId, obsId: edit.obsId, code: target?.code, action: 'dispute', actorRole: 'resident', actorId: edit.who, reason: edit.note }
      break
    }

    case 'statement': {
      // Section 8.2: "expected" or "known" is recorded and shown to the helper. It does not lower the score.
      newStored = addResidentStatement(stored, edit.statementKind, edit.who, edit.note)
      label = { householdId: c.householdId, caseId, action: 'statement', actorRole: 'resident', actorId: edit.who, reason: `${edit.statementKind}${edit.note ? `: ${edit.note}` : ''}` }
      break
    }

    case 'replace': {
      newStored = edit.stored
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
      // P9: Reset also clears resolutions.
      // P10: Reset does NOT retract resident-sourced observations.
      const retractAll = stored.observations.map(o => {
        const { resolvedAt, resolvedBy, ...rest } = o
        // P10: Don't retract resident-sourced observations
        if (o.source === 'resident') {
          return { ...rest, resolvedAt: undefined, resolvedBy: undefined }
        }
        // Section 8.2: every retraction records who, when and why.
        return { ...rest, retracted: true, retractedAt: new Date().toISOString(), retractedBy: edit.who, retractReason: `RESET: ${edit.reason}`, resolvedAt: undefined, resolvedBy: undefined }
      })
      const resetCorrection: Correction = {
        idx: -1, // sentinel: applies to all
        action: 'reject' as const,
        at: new Date().toISOString(),
        who: edit.who,
        reason: `RESET: ${edit.reason}`,
      }
      label = { householdId: c.householdId, caseId, action: 'reset', actorRole: 'helper', actorId: edit.who, reason: edit.reason }
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

  // G1c: Fire emergency alert if case newly became emergency
  const prevMode = (c.controlMode as ControlMode | null) ?? null
  const becameEmergency = risk.minMode === 'emergency' && prevMode !== 'emergency'
  // Spec 7.4: a mode rise is judged on the EFFECTIVE mode (score band and event minimum together). Comparing only the
  // event minimum missed score-only rises, e.g. S_eff 65 (helper-led) with an event minimum of M1.
  const prevEffMode = effectiveModeFor(c.riskScore ?? 0, prevMode)
  const newEffMode = effectiveModeFor(risk.score, risk.minMode)
  const rose = modeRank(newEffMode) > modeRank(prevEffMode)

  // Spec 5: everything keys on the effective score S_eff = max(S, floor of the event minimum mode).
  const eff = effectiveScore(risk.score, risk.minMode)
  const prevEff = Math.max(c.riskScore ?? 0, MODE_FLOOR_SCORE[prevMode ?? 'ai_leads'])
  // Spec 5.2: stamp the time of the last event. Only a real change counts, so a re-score with no change keeps the old time.
  const changed = risk.score !== (c.riskScore ?? 0) || risk.minMode !== ((c.controlMode as ControlMode | null) ?? 'ai_leads')

  // Section 8: a new report after the visitor left may be a new visitor, so the case reopens and says so.
  const isNewEvent = edit.kind === 'append' || edit.kind === 'knock'
  const reopened = isNewEvent && !!c.visitorLeftAt
  const visitorLeftAt = reopened ? null : (c.visitorLeftAt ?? null)
  const pending = await hasPendingHelperRequest(caseId)
  const lifecycle = deriveLifecycleState({
    closedAt: c.closedAt,
    visitorLeftAt,
    activeSerious: risk.activeSerious,
    helperRequestPending: pending,
    helperLedMode: modeRank(effectiveModeFor(risk.score, risk.minMode)) >= modeRank('helper_leads'),
  })

  await getDb().case.update({
    where: { id: caseId },
    data: {
      lifecycle,
      ...(reopened ? { visitorLeftAt: null, possibleNewVisitorAt: new Date() } : {}),
      ...(EVENT_KINDS.has(edit.kind) ? { lastActivityAt: new Date() } : {}),
      riskScore: risk.score,
      riskLedger: risk.ledger as any,
      controlMode: risk.minMode,
      riskLevel: riskLabelFor(eff),
      riskObservations: newStored as any,
    },
  })

  if (!SHADOW) {
    if (becameEmergency) {
      // Emergency has no timer; everyone is alerted now, deadline left alone
      const { alertEmergency } = await import('@/lib/doorbell/store')
      await alertEmergency(c.householdId, caseId)
    } else if (eff > prevEff) {
      // Spec 5.3: when S_eff rises, the governing timer shrinks. Risk-decision = 120 - S_eff; takeover = min(120 - S_eff, 60)
      // once helper-led. Compare-and-set below, and a deadline is never extended.
      const timer = activeTimer(timersFor(eff, risk.minMode, undefined), { riskDecisionNeeded: riskDecisionNeeded(eff) })
      if (timer?.seconds != null) {
        await shortenDeadline(c.householdId, caseId, Date.now() + timer.seconds * 1000, timer.kind, `S_eff ${prevEff}->${eff}`)
      }

      // Section 7.4 step 4: notify helpers when mode rises (0 → 20, or reaches M2/M3)
      // Create risk-decision or takeover requests, deduplicated per (caseId, modeRank)
      if (rose) {
        // Best-effort: the score is already saved, so a failed notification must never fail the edit.
        await notifyModeRise({ caseId, householdId: c.householdId, prevMode: prevEffMode, prevEff, eff, minMode: newEffMode, observations: newStored.observations })
          .catch(e => reportError(e, { fn: 'notifyModeRise', caseId }))
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

    // P8: Fire urgent alert whenever S_eff is 80 to 99 (M4 mode), once per case.
    // Previously this only fired for confirmed immediate_threat.
    // Keep alertEmergency for M5 (S_eff 100).
    const hasConfirmedThreat = risk.ledger.some(
      e => e.code === 'immediate_threat' && e.state === 'confirmed'
    )
    const isUrgentRange = eff >= 80 && eff < 100
    if ((isUrgentRange || hasConfirmedThreat) && !c.urgentAlertedAt) {
      const { alertUrgent } = await import('@/lib/doorbell/store')
      await alertUrgent(c.householdId, caseId, isUrgentRange && !hasConfirmedThreat ? 'score' : 'threat')
    }
  }

  if (label) await logCorrectionLabel({ ...label, scoreBefore: c.riskScore ?? 0, scoreAfter: risk.score })

  return { ok: true }
}

/** Spec 5.3: an AI action exceeded its budget, so a helper decision is now needed. Shrinks the deadline to the
 *  risk-decision timer, never extends it. Compare-and-set, same as applyRiskEdit. */
export async function requestHelperDecision(caseId: string): Promise<void> {
  const db = getDb()
  const c = await db.case.findUnique({ where: { id: caseId }, select: { riskScore: true, controlMode: true, deadlineAt: true, status: true, householdId: true } })
  if (!c || c.status !== 'waiting') return
  const minMode = (c.controlMode as ControlMode | null) ?? null
  const eff = effectiveScore(c.riskScore ?? 0, minMode)
  const t = activeTimer(timersFor(eff, minMode), { riskDecisionNeeded: true })
  if (!t || t.seconds === null) return          // S_eff 0 or 100: no risk-decision timer
  await shortenDeadline(c.householdId, caseId, Date.now() + t.seconds * 1000, 'risk_decision', 'ai_budget_exceeded')
}
