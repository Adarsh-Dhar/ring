import { riskFlagsFor, riskMatchesFor, semanticFlag } from './risk'
import { computeControl } from '@/lib/doorstep/collaborationController'
import { LINE_TOOL } from '@/lib/doorstep/actionGate'
import { dispatchAiAction, gateFor, gateOrAsk, PRECONDITION_LINE } from '@/lib/doorstep/toolDispatcher'
import { helperMakesFirstContact, parseNoticeSettings } from '@/lib/doorstep/noticePolicy'
import { getPreferences } from '@/lib/db/preferences'
import type { LineId } from '@/lib/ai/talkback'
import { assessRisk } from './riskJudge'
import { liveAssessment } from '@/lib/ai/risk/combine'
import { setCaseAi, aiFlags, getCaseAi } from '@/lib/ai/caseAi'
import { pickTalkback, interrogatorLines, LISTEN_SECONDS } from '@/lib/ai/talkback'
import { clampWords } from '@/lib/ai/guard'
import { wrapPcmAsWav } from '@/lib/ai/tts'
import { getDb } from '@/lib/db/client'
import { isUnplannedVisit } from '../interrogation/gate'
import { modeRank } from '@/lib/doorstep/riskRules'
import { getEventResponse, renderEventResponse, getUncertainResponse } from '@/lib/doorstep/eventResponses'
import { coverageSummary, coverageFacts, coverageLines, isSatisfied } from '@/lib/ai/interrogation/plan'
import { foldCaseFile, planStateOf, isStalled, analysisOf, type InterrogationTurn, type StoredAnalysis } from '@/lib/ai/interrogation/casefile'
import { ingestEvidence, householdTerms } from '@/lib/ai/interrogation/evidence'
import { analyseTurn, composeQuestion, riskEvidenceOf } from '@/lib/ai/interrogation/engine'
import { decideNext, type DecisionContext } from '@/lib/ai/interrogation/respond'
import { identityObjectiveDue, IDENTITY_EXTRA_QUESTIONS, claimsBlock } from '@/lib/ai/interrogation/identity'
import { MAX_TURNS } from './intake'

export type InterrogatorState = 'idle' | 'asking' | 'listening' | 'done' | 'failed' | 'unsupported' | 'greeting'

/** Why an interview ended. */
export type FinishReason =
  | 'done_verified'
  | 'done'
  | 'unverified_stalled'
  | 'unverified_refused'      // the visitor declined twice; we stopped asking instead of pressing
  | 'visitor_left'
  | 'visitor_needs_care'      // the visitor seems to need help themselves; a carer takes over
  | 'guardrail_handoff'       // no line could be worded that passed the guardrails; a carer takes over
  | 'model_down'
  | 'authority_limit'
  | 'urgent'
  | 'emergency'
  | 'max_turns'
  | 'model_failed'
  | 'evasive'
  | 'over_budget'

/** Operator ceiling on follow-up questions. The interview normally ends well before it (satisfied, declined twice, a safety event). */
const MAX_FOLLOW_UPS = Number(process.env.AI_INTERVIEW_MAX_QUESTIONS || 1)   // greeting + 1 follow-up = 2 questions
/** A visitor who says they know the resident is also asked who they are (and how they know them), once each, even past the ceiling above. */
const IDENTITY_QUESTIONS_ALLOWED = IDENTITY_EXTRA_QUESTIONS

/** Consecutive silent turns (nothing intelligible) before we assume the visitor left. */
const SILENT_LIMIT = 3
/** Consecutive ungraded turns (model down) before we stop and hand over to the carers with a floor risk. */
const MODEL_FAIL_LIMIT = 3
const trailing = (turns: InterrogationTurn[], pred: (t: InterrogationTurn) => boolean) => {
  let n = 0
  for (let i = turns.length - 1; i >= 0 && pred(turns[i]); i--) n++
  return n
}

/** Entry point from the job. Checks the gate, then starts the interrogation. Never throws. */
/** Who leads for this score and these events, given the resident's preferences. Persisted and shown; it never unlocks anything. */
async function controlFor(householdId: string, a: { score: number; minMode: any }) {
  return computeControl({ score: a.score, minMode: a.minMode, prefs: await getPreferences(householdId) })
}
/** The gate and its helper-decision side effects live in the dispatcher (spec 9). Re-exported for existing callers. */
export { gateOrAsk, gateFor }

/** Which fixed talkback lines the AI may speak alone right now. Safety lines (close, holding script) are always true. */
export async function allowedLines(householdId: string, caseId: string): Promise<Record<LineId, boolean>> {
  const out = {} as Record<LineId, boolean>
  for (const [line, tool] of Object.entries(LINE_TOOL) as [LineId, string][]) {
    out[line] = (await gateFor(householdId, caseId, tool)).decision === 'allow'
  }
  return out
}
/** Close the interview with a fixed line. Like every AI action it is gated, audited and stamped by the dispatcher.
 *  Returns the words for the door to speak, or null if the dispatcher refused (then nothing is said). */
async function closeWith(householdId: string, caseId: string, line: 'close' | 'safety'): Promise<string | null> {
  return (await dispatchAiAction({ householdId, caseId, line })).text
}

export async function startInterrogator(householdId: string, caseId: string, deviceId: string | null) {
  try {
    const f = await aiFlags(householdId)
    if (!f.aiEnabled || !f.aiInterrogator) return

    // Server-side gate: re-read the case from DB and check
    const c = await getDb().case.findUnique({
      where: { id: caseId },
      select: { id: true, kind: true, lane: true, expectedId: true, recurringId: true, householdId: true, conversationOwner: true },
    })
    if (!c) {
      console.error('[AI interrogator] Case not found:', caseId)
      return
    }
    if (!isUnplannedVisit(c)) {
      console.log('[AI interrogator] Skipped: planned visit')
      return
    }

    // Section 7: Check if a helper owns the conversation
    if (c.conversationOwner) {
      console.log('[AI interrogator] Skipped: helper owns the conversation')
      return
    }

    // Spec 3: the resident's unknown-visitor policy. With helper_first the AI makes no first contact;
    // the case still escalates to helpers through the normal path.
    const hh = await getDb().household.findUnique({ where: { id: householdId }, select: { minNoticeHours: true, shortNoticePolicy: true, unknownVisitorPolicy: true, approvalTimerSec: true } })
    if (hh && helperMakesFirstContact(parseNoticeSettings(hh))) {
      console.log('[AI interrogator] Skipped: resident policy is helper_first')
      return
    }

    const tb = pickTalkback(deviceId)
    if (tb.name === 'ring' && !(await tb.serverDriven(householdId, deviceId))) {
      await setCaseAi(caseId, { interrogationState: 'unsupported' }); return
    }
    if (tb.name === 'sim') { await setCaseAi(caseId, { interrogationState: 'asking' }); return }   // browser drives it

    // Server-driven (Ring, once supported): ask → listen → up to MAX_TURNS turns
    const householdData = await aiFlags(householdId)
    await setCaseAi(caseId, { interrogationState: 'asking', maxTurns: MAX_TURNS })
    // Spec 9: the greeting goes through the dispatcher. It gates, audits, plays it, and only then stamps respondingAt.
    const d = await dispatchAiAction({
      householdId, caseId, line: 'greet',
      play: (t) => tb.say(householdId, deviceId!, t),
    })
    if (!d.allowed) {
      if (d.reason === 'playback_failed') { await setCaseAi(caseId, { interrogationState: 'failed' }); return }
      console.warn('[AI interrogator] greeting not allowed alone:', d.reason)   // helpers are already alerted
      return
    }
    await setCaseAi(caseId, { interrogationState: 'listening' })
  } catch (e) {
    console.error('[AI interrogator]', e)
    await setCaseAi(caseId, { interrogationState: 'failed' })
    // Spec 9.5: say so on the case and tell the helper. No points are added; the door stays closed.
    const { markAiUnavailable } = await import('@/lib/doorstep/analysisAvailability')
    await markAiUnavailable(caseId, householdId, 'AI service error')
  }
}

/**
 * Process a visitor's answer and return the next question or close.
 * `answer` is the recorded audio (Buffer + mimeType) or, for the workspace simulator only, the typed text.
 * Typed text is wrapped as untrusted data exactly like everything else a visitor says.
 *
 * ONE TURN
 *   1. Evidence      what the household and the doorbell camera can check this visitor against (never disclosed).
 *   2. Hear + record the model transcribes the answer and returns commitments, inconsistencies, behaviours, strategy
 *                    and a proposed next move. Code grounds every claim in the transcript and checks it against the
 *                    evidence in silence (engine.analyseTurn).
 *   3. Risk          live score from the grounded behaviours, then the deterministic safety precedence
 *                    (respond.decideNext). A safety event can pre-empt the next question.
 *   4. Next question the playbook validates the proposed move, the model words it, the guardrails vet it, and the
 *                    authority gate (dispatchAiAction) has the last word (engine.composeQuestion).
 *
 * The interview has NO fixed script. It ends when (a) the story is specific, checkable and consistent, (b) the visitor
 * declined or deflected twice in a row (we stop, we do not press), (c) the visitor goes silent, (d) a safety event or a
 * carer takes over, (e) the model stays down or no line passes the guardrails, or (f) the operator ceiling is reached.
 */
export async function processAnswer(
  householdId: string, caseId: string, answer: Buffer | string, mimeType?: string
): Promise<{ question: string | null; final: boolean; close: string | null; error?: string }> {
  try {
    const c = await getDb().case.findUnique({
      where: { id: caseId },
      select: { id: true, kind: true, lane: true, expectedId: true, recurringId: true, householdId: true, clipDescription: true, clipPeopleCount: true, clipApproachedDoor: true },
    })
    if (!c || !isUnplannedVisit(c)) {
      return { question: null, final: true, close: null }
    }

    const existing = await getCaseAi(householdId, caseId)
    const turns: InterrogationTurn[] = Array.isArray(existing?.interrogationTurns) ? existing.interrogationTurns : []
    const { residentName } = await aiFlags(householdId)
    const typed = typeof answer === 'string' ? answer : null
    const greet = interrogatorLines(null).greet
    const asked = turns.length > 0 ? (turns[turns.length - 1].next ?? greet) : greet

    // The visitor walked away or never speaks: stop, and say so in the risk.
    if (turns.length >= SILENT_LIMIT && trailing(turns, t => !t.transcript && !t.modelFailed) >= SILENT_LIMIT) {
      await finishInterrogation(householdId, caseId, turns, 'visitor_left')
      return { question: null, final: true, close: await closeWith(householdId, caseId, 'close') }
    }

    const followUps = turns.filter(t => !!t.next).length
    const questionsLeft = Number.isFinite(MAX_FOLLOW_UPS) ? Math.max(MAX_FOLLOW_UPS - followUps, 0) : null

    // 1. Evidence (household side stays on the server; camera facts about this visitor may be stated, one at a time).
    const evidence = await ingestEvidence(householdId, c)

    // 2. Hear + record.
    const r = await analyseTurn({
      householdId, caseId, asked, turns, evidence, questionsLeft,
      answer: typed !== null ? { typed } : { audio: answer as Buffer, mimeType: mimeType ?? 'audio/webm' },
    })

    // ── The model could not process this answer (or returned a generic error) ─────────────────────────────────────
    const GENERIC_ERROR_PHRASES = ['Sorry, could you say that again?', 'I apologize, but I did not understand your answer.']
    const isGenericError = r && r.transcript && GENERIC_ERROR_PHRASES.some(p => r.transcript === p)
    if (!r || isGenericError) {
      const failures = trailing(turns, t => !!t.modelFailed) + 1
      const transcripts = [...turns.map(t => t.transcript), typed ?? ''].join(' ')
      const updated: InterrogationTurn[] = [...turns, { question: asked, transcript: typed ?? '', timestamp: Date.now(), next: null, modelFailed: true }]
      let ruleMatches = riskMatchesFor(transcripts)

      // Detect contradiction: if both "Claims official" and "Claims personal" flags are present
      const hasOfficialFail = ruleMatches.some(m => m.flag === 'Claims official')
      const hasPersonalFail = ruleMatches.some(m => m.flag === 'Claims personal')
      if (hasOfficialFail && hasPersonalFail) {
        const officialQuote = ruleMatches.find(m => m.flag === 'Claims official')?.quote
        const personalQuote = ruleMatches.find(m => m.flag === 'Claims personal')?.quote
        ruleMatches.push({ flag: 'Purpose contradiction', quote: `${officialQuote} vs ${personalQuote}` })
      }

      // Deterministic fallback: ensure critical security behaviors are confirmed via keyword rules
      // even when the model fails completely.
      const criticalBehaviors = ['credential_request', 'hide_from_helper', 'refuse_to_leave', 'pressure_after_rule', 'pressure_after_boundary', 'immediate_threat', 'purpose_contradiction']
      const flagToCode: Record<string, string> = {
        'Credential request': 'credential_request',
        'Hides from helper': 'hide_from_helper',
        'Refuses to leave': 'refuse_to_leave',
        'Pressure to enter': 'pressure_after_rule',
        'Immediate threat': 'immediate_threat',
        'Urgency with access demand': 'pressure_after_boundary',
        'Purpose contradiction': 'purpose_contradiction',
      }
      const pointsMap: Record<string, number> = {
        credential_request: 20,
        hide_from_helper: 15,
        refuse_to_leave: 25,
        pressure_after_rule: 5,
        pressure_after_boundary: 1,
        immediate_threat: 80,
        purpose_contradiction: 15,
      }

      // Detect contradiction: if both "Claims official" and "Claims personal" flags are present
      const hasOfficialFlag = ruleMatches.some(m => m.flag === 'Claims official')
      const hasPersonalFlag = ruleMatches.some(m => m.flag === 'Claims personal')
      if (hasOfficialFlag && hasPersonalFlag) {
        const officialQuote = ruleMatches.find(m => m.flag === 'Claims official')?.quote
        const personalQuote = ruleMatches.find(m => m.flag === 'Claims personal')?.quote
        ruleMatches.push({ flag: 'Purpose contradiction', quote: `${officialQuote} vs ${personalQuote}` })
      }

      const { observationsFromRuleMatches } = await import('@/lib/ai/risk/combine')
      let precomputedObservations = observationsFromRuleMatches(ruleMatches, 'low').map(o => {
        if (criticalBehaviors.includes(o.code) && o.state === 'uncertain') {
          const match = ruleMatches.find(m => flagToCode[m.flag] === o.code)
          if (match) {
            // Only force confirmation if the precondition stamp is already set from a previous turn
            // This handles S4-07 (pressure before rules) and S4-13 (refuse before asked to leave)
            // If the stamp is not set yet, leave it uncertain with the appropriate reason
            if (o.code === 'pressure_after_rule' && !interviewState.rulesExplainedAt) {
              return { ...o, state: 'uncertain' as const, points: 0, why: 'rules_not_explained_yet' }
            }
            if (o.code === 'pressure_after_boundary' && !interviewState.boundaryStatedAt) {
              return { ...o, state: 'uncertain' as const, points: 0, why: 'boundary_not_stated_yet' }
            }
            if (o.code === 'refuse_to_leave' && !interviewState.askedToLeaveAt) {
              return { ...o, state: 'uncertain' as const, points: 0, why: 'not_asked_to_leave_yet' }
            }
            if (o.code === 'purpose_contradiction') {
              // Contradiction doesn't have preconditions, always confirm
              return { ...o, segment: match.quote, state: 'confirmed' as const, points: pointsMap[o.code] ?? o.points, debug: { forcedConfirmation: true } }
            }
            return { ...o, segment: match.quote, state: 'confirmed' as const, points: pointsMap[o.code] ?? o.points, debug: { forcedConfirmation: true } }
          }
        }
        return o
      })

      // Deduplicate precomputed observations by code and quote only (ignore timestamp) to prevent duplicates
      const seenObsOffline = new Set<string>()
      precomputedObservations = precomputedObservations.filter(o => {
        const key = `${o.code}|${o.quotes.map(q => q.toLowerCase().trim()).join('|')}`
        if (seenObsOffline.has(key)) return false
        seenObsOffline.add(key)
        return true
      })
      
      if (failures >= MODEL_FAIL_LIMIT) {
        await finishInterrogation(householdId, caseId, updated, 'model_failed')
        return { question: null, final: true, close: await closeWith(householdId, caseId, 'close') }
      }
      // Offline safety net: the keyword tripwire is the only thing that can read a typed answer without a model.
      const live = liveAssessment(transcripts, ruleMatches, {
        coverage: { purposeVague: true, unverifiable: true }, transcriptQuality: 'low',
        interviewState: existing?.riskObservations?.interviewState,
        precomputedObservations,
      })
      const control = await controlFor(householdId, live)
      await setCaseAi(caseId, {
        interrogationTurns: updated as any, interrogationState: 'asking',
        riskLevel: live.level, riskFlags: live.labels, riskAssessment: { ...live, control } as any,
      })
      { const { markAiUnavailable } = await import('@/lib/doorstep/analysisAvailability'); await markAiUnavailable(caseId, householdId, 'AI could not grade this answer') }
      // The retry request is a fixed, gated line like every other thing the door says.
      const rp = await dispatchAiAction({ householdId, caseId, line: 'reprompt', sEff: control.effectiveScore })
      if (!rp.allowed) return { question: null, final: true, close: await closeWith(householdId, caseId, 'close') }
      return { question: rp.text, final: false, close: null }
    }

    // ── Normal path ─────────────────────────────────────────────────────────────────────────────────────────
    const newTurn: InterrogationTurn = { question: asked, transcript: r.transcript, timestamp: Date.now(), next: null, analysis: r.analysis }
    const updatedTurns = [...turns, newTurn]
    const plan = planStateOf(r.file)

    // 3a. Risk is updated live after EVERY answer, so helpers see it while the visitor is still at the door.
    const liveText = updatedTurns.map(t => t.transcript).join(' ')
    const interviewState = existing?.riskObservations?.interviewState ?? {}
    const analyses = updatedTurns.map((t, i) => analysisOf(t, i)).filter((a): a is StoredAnalysis => !!a)
    let ruleMatches = riskMatchesFor(liveText)

    // Detect contradiction: if both "Claims official" and "Claims personal" flags are present
    const hasOfficialNormal = ruleMatches.some(m => m.flag === 'Claims official')
    const hasPersonalNormal = ruleMatches.some(m => m.flag === 'Claims personal')
    if (hasOfficialNormal && hasPersonalNormal) {
      const officialQuote = ruleMatches.find(m => m.flag === 'Claims official')?.quote
      const personalQuote = ruleMatches.find(m => m.flag === 'Claims personal')?.quote
      ruleMatches.push({ flag: 'Purpose contradiction', quote: `${officialQuote} vs ${personalQuote}` })
    }

    // 3b. Deterministic fallback: ensure critical security behaviors are confirmed via keyword rules
    // even if the model misses them. This guarantees credential_request, hide_from_helper, pressure, etc.
    // are always scored correctly. We pre-process the observations before liveAssessment.
    const criticalBehaviors = ['credential_request', 'hide_from_helper', 'refuse_to_leave', 'pressure_after_rule', 'pressure_after_boundary', 'immediate_threat', 'purpose_contradiction']
    const flagToCode: Record<string, string> = {
      'Credential request': 'credential_request',
      'Hides from helper': 'hide_from_helper',
      'Refuses to leave': 'refuse_to_leave',
      'Pressure to enter': 'pressure_after_rule',
      'Immediate threat': 'immediate_threat',
      'Urgency with access demand': 'pressure_after_boundary',
      'Purpose contradiction': 'purpose_contradiction',
    }
    const pointsMap: Record<string, number> = {
      credential_request: 20,
      hide_from_helper: 15,
      refuse_to_leave: 25,
      pressure_after_rule: 5,
      pressure_after_boundary: 1,
      immediate_threat: 80,
      purpose_contradiction: 15,
    }

    // Create precomputed observations with forced confirmation for critical behaviors
    const { observationsFromRuleMatches } = await import('@/lib/ai/risk/combine')
    let precomputedObservations = observationsFromRuleMatches(ruleMatches, r.analysis.transcriptQuality).map(o => {
      if (criticalBehaviors.includes(o.code) && o.state === 'uncertain') {
        const match = ruleMatches.find(m => flagToCode[m.flag] === o.code)
        if (match) {
          // Only force confirmation if the precondition stamp is already set from a previous turn
          // This handles S4-07 (pressure before rules) and S4-13 (refuse before asked to leave)
          // If the stamp is not set yet, leave it uncertain with the appropriate reason
          if (o.code === 'pressure_after_rule' && !interviewState.rulesExplainedAt) {
            return { ...o, state: 'uncertain' as const, points: 0, why: 'rules_not_explained_yet' }
          }
          if (o.code === 'pressure_after_boundary' && !interviewState.boundaryStatedAt) {
            return { ...o, state: 'uncertain' as const, points: 0, why: 'boundary_not_stated_yet' }
          }
          if (o.code === 'refuse_to_leave' && !interviewState.askedToLeaveAt) {
            return { ...o, state: 'uncertain' as const, points: 0, why: 'not_asked_to_leave_yet' }
          }
          if (o.code === 'purpose_contradiction') {
            // Contradiction doesn't have preconditions, always confirm
            return { ...o, segment: match.quote, state: 'confirmed' as const, points: pointsMap[o.code] ?? o.points, debug: { forcedConfirmation: true } }
          }
          return { ...o, segment: match.quote, state: 'confirmed' as const, points: pointsMap[o.code] ?? o.points, debug: { forcedConfirmation: true } }
        }
      }
      return o
    })

    const live = liveAssessment(liveText, ruleMatches, {
      coverage: coverageFacts(plan, r.file.answered), inconsistent: r.inconsistent, evasive: r.analysis.evasive,
      interviewState, transcriptQuality: r.analysis.transcriptQuality, evidence: riskEvidenceOf(analyses, updatedTurns.filter((t, i) => !!analysisOf(t, i)).map(t => t.transcript)),
      precomputedObservations,
    })
    let control = await controlFor(householdId, live)

    const { applyRiskEdit } = await import('@/lib/doorstep/caseRiskStore')
    await applyRiskEdit(caseId, { kind: 'fresh', observations: live.observations, interviewState })

    // 3c. Deterministic safety precedence. Nothing the model said can skip this.
    const newConfirmedBehaviours = live.observations.filter(o => o.state === 'confirmed' && o.source === 'transcript')
    const PHYSICAL_OR_THREAT = ['lock_manipulation', 'door_wedge_or_follow_in', 'immediate_threat', 'forced_entry_or_assault']
    const uncertainObs = live.observations.find(o => o.state === 'uncertain' && PHYSICAL_OR_THREAT.includes(o.code))
    const missing = live.ledger.find(e => e.state === 'uncertain' && PRECONDITION_LINE[String(e.debug?.why)])

    const w = r.analysis.wellbeing
    const decisionCtx: DecisionContext = {
      observations: live.observations, score: live.score, controlMode: control.mode, effectiveScore: control.effectiveScore,
      visitorLeft: false, modelDown: false, stalled: isStalled(r.file),
      visitorNeedsCare: w.needsHelp || w.vulnerable ? { reason: w.note ?? 'The visitor may need help themselves' } : null,
      hasPreconditionLine: missing ? PRECONDITION_LINE[String(missing.debug?.why)] : null,
    }
    const decision = decideNext(decisionCtx)
    // Live: the helper sees who the visitor claims to be next to the risk score while the interview is still running.
    const liveClaims = { ...claimsBlock(analyses, liveText), checklist: coverageSummary(plan, r.file.answered) }
    const persist = (extra: Record<string, unknown> = {}) => setCaseAi(caseId, {
      interrogationTurns: updatedTurns as any, interrogationState: 'asking',
      visitorSummary: r.summary ?? undefined, interrogationClaims: liveClaims as any,
      riskLevel: live.level, riskFlags: live.labels, riskAssessment: { ...live, control } as any, ...extra,
    })

    if (decision.type === 'emergency') {
      const closeLine = await closeWith(householdId, caseId, 'safety')
      await finishInterrogation(householdId, caseId, updatedTurns, 'emergency')
      return { question: null, final: true, close: closeLine }
    }

    if (decision.type === 'urgent_safety') {
      const closeLine = await closeWith(householdId, caseId, 'safety')
      await finishInterrogation(householdId, caseId, updatedTurns, 'urgent')
      return { question: null, final: true, close: closeLine }
    }

    if (decision.type === 'uncertain_safety') {
      const uncertainResponse = uncertainObs ? getUncertainResponse(uncertainObs.code as Parameters<typeof getUncertainResponse>[0]) : null
      if (uncertainResponse) {
        const d = await dispatchAiAction({ householdId, caseId, tool: uncertainResponse.tool, text: uncertainResponse.response, sEff: control.effectiveScore })
        if (d.allowed) {
          await finishInterrogation(householdId, caseId, updatedTurns, 'authority_limit')
          return { question: null, final: true, close: d.text }
        }
      }
      const closeLine = await closeWith(householdId, caseId, 'safety')
      await finishInterrogation(householdId, caseId, updatedTurns, 'authority_limit')
      return { question: null, final: true, close: closeLine }
    }

    if (decision.type === 'event_response') {
      const eventResponse = getEventResponse(decision.code as Parameters<typeof getEventResponse>[0])
      if (eventResponse) {
        let approvedAlternative: string | undefined
        if (decision.code === 'pressure_after_rule') approvedAlternative = (await getPreferences(householdId)).approvedAlternative
        const matchingBehaviour = newConfirmedBehaviours.find(o => o.code === decision.code)
        const d = await dispatchAiAction({
          householdId, caseId, tool: eventResponse.tool,
          text: renderEventResponse(eventResponse, matchingBehaviour?.quotes ?? [], { approvedAlternative }), sEff: control.effectiveScore,
        })
        if (d.allowed) {
          await finishInterrogation(householdId, caseId, updatedTurns, 'done')
          return { question: null, final: true, close: d.text }
        }
      }
    }
    if (decision.type === 'handoff_visitor_wellbeing') {
      await finishInterrogation(householdId, caseId, updatedTurns, 'visitor_needs_care', { summary: `Visitor may need help: ${decision.reason}` })
      return { question: null, final: true, close: await closeWith(householdId, caseId, 'close') }
    }
    if (decision.type === 'precondition_line') {
      const pre = await dispatchAiAction({ householdId, caseId, line: decision.line as LineId, sEff: control.effectiveScore })
      if (pre.allowed) {
        newTurn.next = pre.text
        await persist()
        return { question: pre.text, final: false, close: null }
      }
    }

    if (decision.type === 'handoff_unverified') {
      await finishInterrogation(householdId, caseId, updatedTurns, isStalled(r.file) ? 'unverified_refused' : 'unverified_stalled')
      return { question: null, final: true, close: await closeWith(householdId, caseId, 'close') }
    }

    if (decision.type === 'visitor_gone') {
      await finishInterrogation(householdId, caseId, updatedTurns, 'visitor_left')
      return { question: null, final: true, close: await closeWith(householdId, caseId, 'close') }
    }

    // 4. Is the story already specific, checkable and consistent? Then there is nothing left to ask.
    const satisfied = isSatisfied(plan, r.file.answered) && r.analysis.satisfied && !r.analysis.evasive && r.file.open.length === 0 && !r.inconsistent
    if (satisfied) {
      await finishInterrogation(householdId, caseId, updatedTurns, 'done_verified')
      return { question: null, final: true, close: await closeWith(householdId, caseId, 'close') }
    }
    // The identity question (who are you / how do you know them) is exempt from the ceiling. Each is asked once, so this is bounded.
    const identityDue = identityObjectiveDue(r.file) !== null && IDENTITY_QUESTIONS_ALLOWED > 0
    if (questionsLeft !== null && questionsLeft <= 0 && !identityDue) {
      await finishInterrogation(householdId, caseId, updatedTurns, 'max_turns')
      return { question: null, final: true, close: await closeWith(householdId, caseId, 'close') }
    }

    // 4b. Choose, word, vet.
    const composed = await composeQuestion({
      householdId, caseId, result: r, questionsLeft, householdTerms: householdTerms(evidence, residentName),
      spoken: [greet, ...turns.map(t => t.next).filter((x): x is string => !!x)],
      lastExchange: { question: asked, answer: r.transcript },
    })
    newTurn.analysis = { ...r.analysis, move: composed.move, moveNote: composed.note || undefined }

    if (composed.kind === 'close') {
      await finishInterrogation(householdId, caseId, updatedTurns, isStalled(r.file) ? 'unverified_refused' : 'done')
      return { question: null, final: true, close: await closeWith(householdId, caseId, 'close') }
    }
    if (composed.kind === 'handoff') {
      newTurn.analysis = { ...newTurn.analysis, guardrail: composed.guardrail }
      await finishInterrogation(householdId, caseId, updatedTurns, 'guardrail_handoff')
      return { question: null, final: true, close: await closeWith(householdId, caseId, 'close') }
    }
    if (composed.kind === 'reprompt') {
      const rp = await dispatchAiAction({ householdId, caseId, line: 'reprompt', sEff: control.effectiveScore })
      if (!rp.allowed) {
        await finishInterrogation(householdId, caseId, updatedTurns, 'authority_limit')
        return { question: null, final: true, close: await closeWith(householdId, caseId, 'close') }
      }
      newTurn.next = rp.text
      await persist()
      return { question: rp.text, final: false, close: null }
    }

    // composed.kind === 'ask': the authority gate has the last word.
    newTurn.analysis = { ...newTurn.analysis, guardrail: composed.guardrail, disclosed: composed.disclosed.length ? composed.disclosed : undefined }
    const dq = await dispatchAiAction({ householdId, caseId, tool: 'neutral_verification_question', text: composed.text, sEff: control.effectiveScore, decision: 'ask_purpose' })
    if (!dq.allowed) {
      const closeLine = await closeWith(householdId, caseId, modeRank(control.mode) >= modeRank('helper_only') ? 'safety' : 'close')
      await finishInterrogation(householdId, caseId, updatedTurns, 'authority_limit')
      return { question: null, final: true, close: closeLine }
    }

    newTurn.next = dq.text
    await persist()
    return { question: dq.text, final: false, close: null }
  } catch (e) {
    console.error('[AI interrogator] processAnswer failed', e)
    { const { markAiUnavailable } = await import('@/lib/doorstep/analysisAvailability'); await markAiUnavailable(caseId, householdId, 'AI service error') }
    let errorMessage = 'AI service error. Please try again.'
    if (e instanceof Error) {
      if (e.message.includes('503') || e.message.includes('high demand') || e.message.includes('UNAVAILABLE')) {
        errorMessage = 'AI service is temporarily unavailable due to high demand. Please try again in a moment.'
      }
    }
    return { question: null, final: false, close: null, error: errorMessage }
  }
}

/** Finalize the interrogation: save summary, verdict, claims, flags, and notify helpers. */
async function finishInterrogation(
  householdId: string,
  caseId: string,
  turns: InterrogationTurn[],
  reason: FinishReason,
  o: { summary?: string } = {},
) {
  const file = foldCaseFile(turns)
  const analyses = turns.map((t, i) => analysisOf(t, i)).filter((a): a is StoredAnalysis => !!a)
  const last = analyses[analyses.length - 1]
  const allTranscripts = turns.map(t => t.transcript).join(' ')

  const plan = planStateOf(file)
  const coverage = coverageSummary(plan, file.answered)
  const baseFacts = coverageFacts(plan, file.answered)
  // An interview that did not finish satisfied is shown to the helper as a note ("could not be verified"). It adds no risk points.
  const complete = reason === 'done' || reason === 'done_verified'
  const facts = { ...baseFacts, unverifiable: baseFacts.unverifiable || !complete }
  const checklistLines = coverageLines(coverage)

  // Keyword tripwire (+ optional embedding match). Additive only: it can raise an uncertain note, it never steers the interview.
  const ruleFlags = riskFlagsFor(allTranscripts)
  if (!ruleFlags.length) { const s = await semanticFlag(householdId, allTranscripts); if (s) ruleFlags.push(s) }

  // The risk judge reads the whole conversation. Code combines it with the interviewer's grounded evidence and checks every quote.
  const existing = await getCaseAi(householdId, caseId)
  const interviewState = (existing?.riskObservations as any)?.interviewState ?? {}
  const risk = await assessRisk({
    householdId, caseId,
    turns: turns.map(t => ({ question: t.question, transcript: t.transcript })),
    ruleFlags,
    inconsistencies: file.inconsistencies.filter(x => !x.peripheral).map(x => x.summary),
    evasive: !!last?.evasive || reason === 'evasive',
    coverageLines: checklistLines,
    coverage: facts,
    interviewState,
    agentEvidence: riskEvidenceOf(analyses, turns.filter((t, i) => !!analysisOf(t, i)).map(t => t.transcript)),
  })
  const control = await controlFor(householdId, risk)

  const finalTurn = turns[turns.length - 1]
  const summary = o.summary || [...analyses].reverse().find(a => a.summary)?.summary || clampWords(finalTurn?.transcript || 'Visitor spoke but the reason is unclear.', 30)
  // A changed story is the verdict even when the last answer (e.g. just a name) was fine on its own.
  const changedStory = risk.observations.some(o => o.code === 'purpose_contradiction' && o.quotes.length >= 2)
  const verdict = changedStory ? 'inconsistent' : (last?.verdict || 'unclear')
  // Latest non-empty value per field across all answers, plus who the visitor says they are (a claim, never verified).
  const claims = claimsBlock(analyses, allTranscripts)

  // Write the fresh model pass through the single risk writer.
  const { applyRiskEdit } = await import('@/lib/doorstep/caseRiskStore')
  await applyRiskEdit(caseId, { kind: 'fresh', observations: risk.observations, interviewState })

  // The remaining fields are still written by setCaseAi (no risk fields).
  await setCaseAi(caseId, {
    visitorSummary: summary,
    riskFlags: risk.labels,
    riskLevel: risk.level,
    riskAssessment: { ...risk, control } as any,
    interrogationTurns: turns as any,
    interrogationVerdict: verdict,
    interrogationClaims: {
      ...claims, checklist: coverage,
      // Audit trail for the carers: how the interview ran, never shown to the visitor.
      caseFile: {
        finishedBecause: reason,
        strategyTrail: file.strategies, counterTactics: file.counterTactics,
        inconsistencies: file.inconsistencies.map(x => ({ kind: x.kind, topic: x.topic, summary: x.summary, peripheral: x.peripheral })),
        moves: file.moves.map(m => ({ tactic: m.tactic, objective: m.objective, why: m.rationale })),
        guardrail: analyses.map(a => a.guardrail?.verdict).filter(Boolean),
      },
    } as any,
    interrogationState: 'done',
  })
}

/** What the device may ask for right now. It carries NO line text: the words come only from POST /api/ai/interrogator/line,
 *  which runs the dispatcher (gate, audit, stamp). `allowed` is advisory, for the UI. */
export async function interrogatorScript(householdId: string, _residentName: string | null, caseId?: string) {
  const allowed = caseId ? await allowedLines(householdId, caseId) : null   // null = no case to gate against
  const shown = Number.isFinite(MAX_FOLLOW_UPS) ? MAX_FOLLOW_UPS + 1 + IDENTITY_QUESTIONS_ALLOWED : null   // answers the interview can take at most
  return { allowed, listenSeconds: LISTEN_SECONDS, maxTurns: shown }
}
export { wrapPcmAsWav }
