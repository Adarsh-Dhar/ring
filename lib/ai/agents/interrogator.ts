import { generateJson } from '@/lib/ai/client'
import { InterrogatorTurnOut, type InterrogatorTurnResult } from '@/lib/ai/schemas'
import { INTERROGATOR_SYSTEM } from '@/lib/ai/prompts/interrogator'
import { riskFlagsFor, riskMatchesFor, semanticFlag } from './risk'
import { computeControl } from '@/lib/doorstep/collaborationController'
import { LINE_TOOL } from '@/lib/doorstep/actionGate'
import { dispatchAiAction, gateFor, gateOrAsk, PRECONDITION_LINE } from '@/lib/doorstep/toolDispatcher'
import { helperMakesFirstContact, parseNoticeSettings } from '@/lib/doorstep/noticePolicy'
import { getPreferences } from '@/lib/db/preferences'
import type { Decision } from '@/lib/doorstep/residentPreferences'
import type { LineId } from '@/lib/ai/talkback'
import { assessRisk } from './riskJudge'
import { liveAssessment } from '@/lib/ai/risk/combine'
import { setCaseAi, aiFlags, getCaseAi } from '@/lib/ai/caseAi'
import { pickTalkback, interrogatorLines, LISTEN_SECONDS } from '@/lib/ai/talkback'
import { clampWords, hasBannedPhrase, validQuestion, wrapUntrusted } from '@/lib/ai/guard'
import { wrapPcmAsWav } from '@/lib/ai/tts'
import { getDb } from '@/lib/db/client'
import { isUnplannedVisit } from '../interrogation/gate'
import { modeRank } from '@/lib/doorstep/riskRules'
import { getEventResponse, renderEventResponse, getUncertainResponse } from '@/lib/doorstep/eventResponses'
import {
  MAX_TURNS,
  type PlanTurn,
  cleanObs,
  foldPlan,
  nextFocus,
  isSatisfied,
  isSlot,
  isEchoOfName,
  coverageSummary,
  coverageFacts,
  coverageLines,
  type Slot,
} from '@/lib/ai/interrogation/plan'

export type InterrogatorState = 'idle' | 'asking' | 'listening' | 'done' | 'failed' | 'unsupported' | 'greeting'

/** P7: Reason for finishing interrogation - extended for pressure_continues */
export type FinishReason = 'done' | 'max_turns' | 'evasive' | 'invalid_question' | 'banned_question' | 'model_failed' | 'over_budget' | 'pressure_continues'

interface InterrogationTurn {
  question: string      // the question this answer replies to
  transcript: string
  timestamp: number
  next?: string | null  // the follow-up we asked after this answer (becomes the next turn's question)
  obs?: any             // coverage from this turn (raw model output, cleaned by plan module)
  focus?: Slot | null   // the slot we asked about (next question's focus)
  claimsOrg?: boolean
  claimsOrganisation?: boolean // New field from InterrogatorTurnOut schema
  personalTie?: boolean
  claimsPersonalTie?: boolean // New field from InterrogatorTurnOut schema
  echoTarget?: boolean
  riskHint?: 'none' | 'low' | 'medium' | 'high'
  modelFailed?: boolean // the model could not grade this answer (no coverage recorded)
}

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
    await setCaseAi(caseId, { interrogationState: 'asking', maxTurns: MAX_TURNS, residentName: householdData.residentName })
    // Spec 9: the greeting goes through the dispatcher. It gates, audits, plays it, and only then stamps respondingAt.
    const d = await dispatchAiAction({
      householdId, caseId, line: 'greet', residentName: householdData.residentName,
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
  }
}

/**
 * Process a visitor's answer and return the next question or close.
 * `answer` is the recorded audio (Buffer + mimeType) or, for the workspace simulator only, the typed text.
 * Typed text is wrapped as untrusted data exactly like everything else a visitor says.
 *
 * The interview has NO turn limit. It ends only when (a) the code and the model both say the story is specific,
 * checkable and consistent, (b) the visitor goes silent, (c) the model stays down, or (d) an operator ceiling is set.
 */
export async function processAnswer(
  householdId: string, caseId: string, answer: Buffer | string, mimeType?: string
): Promise<{ question: string | null; final: boolean; close: string | null; error?: string }> {
  try {
    const c = await getDb().case.findUnique({
      where: { id: caseId },
      select: { id: true, kind: true, lane: true, expectedId: true, recurringId: true, householdId: true },
    })
    if (!c || !isUnplannedVisit(c)) {
      return { question: null, final: true, close: null }
    }

    const existing = await getCaseAi(householdId, caseId)
    const turns: InterrogationTurn[] = Array.isArray(existing?.interrogationTurns) ? existing.interrogationTurns : []
    const householdData = await aiFlags(householdId)
    const residentName = householdData.residentName ?? null
    const typed = typeof answer === 'string' ? answer : null
    const greet = interrogatorLines(null).greet
    const asked = turns.length > 0 ? (turns[turns.length - 1].next ?? greet) : greet

    // Optional operator ceiling (AI_INTERROGATOR_MAX_TURNS). Unlimited by default.
    if (turns.length >= MAX_TURNS) {
      await finishInterrogation(householdId, caseId, turns, 'max_turns')
      return { question: null, final: true, close: await closeWith(householdId, caseId, 'close') }
    }

    // The visitor walked away or never speaks: stop, and say so in the risk.
    if (turns.length >= SILENT_LIMIT && trailing(turns, t => !t.transcript && !t.modelFailed) >= SILENT_LIMIT) {
      await finishInterrogation(householdId, caseId, turns, 'evasive')
      return { question: null, final: true, close: await closeWith(householdId, caseId, 'close') }
    }

    // P7: M2 - if a confirmed pressure_after_boundary appears, stop questioning, say the boundary line, and hand over.
    // Defer this check to after the model output is available (below) to avoid duplicate risk assessment

    const planTurns: PlanTurn[] = turns.map(t => ({
      obs: cleanObs(t.obs), focus: t.focus, claimsOrg: t.claimsOrganisation ?? t.claimsOrg, personalTie: t.claimsPersonalTie ?? t.personalTie,
      echoTarget: t.echoTarget, riskHint: t.riskHint,
    }))
    const state = foldPlan(planTurns)
    const slotsInfo = Object.entries(state.status)
      .map(([k, v]) => `${k}: ${v} (asked ${state.asks[k as Slot]} times)`)
      .join(', ')

    // Build history from previous turns
    const history = turns.map(t => `Q: ${t.question}\nA: ${t.transcript || '(no transcript)'}`).join('\n\n')

    // The client now handles model fallbacks automatically for 503 errors
    const out = await generateJson({
      agent: 'interrogator', householdId, caseId, role: 'workhorse', schema: InterrogatorTurnOut, maxOutputTokens: 600,
      system: INTERROGATOR_SYSTEM,
      parts: [
        typed !== null
          ? { text: `The visitor typed this reply (no audio):\n${wrapUntrusted('visitor_answer', typed, 500)}` }
          : { inlineData: { mimeType: mimeType ?? 'audio/webm', data: (answer as Buffer).toString('base64') } },
        { text: `Question this answers: ${asked}\n\nPrevious Q&A:\n${history || '(none yet)'}\n\nCurrent interview state (what we know so far):\n${slotsInfo}\n\nCurrent answer: Transcribe, grade, and decide the next step.` },
      ],
    })

    // ── Model could not grade this answer: ask to try again ────────────────────────────────────────────────
    if (!out) {
      const failures = trailing(turns, t => !!t.modelFailed) + 1
      const transcripts = [...turns.map(t => t.transcript), typed ?? ''].join(' ')
      const updated = [...turns, {
        question: asked, transcript: typed ?? '', timestamp: Date.now(), next: null, obs: {}, focus: null, modelFailed: true,
      }]
      if (failures >= MODEL_FAIL_LIMIT) {
        await finishInterrogation(householdId, caseId, updated, 'model_failed')
        return { question: null, final: true, close: await closeWith(householdId, caseId, 'close') }
      }
      const live = liveAssessment(transcripts, riskMatchesFor(transcripts), {
        coverage: { purposeVague: true, unverifiable: true },
      })
      const control = await controlFor(householdId, live)
      await setCaseAi(caseId, {
        interrogationTurns: updated as any, interrogationState: 'asking',
        riskLevel: live.level, riskFlags: live.labels, riskAssessment: { ...live, control: control } as any,
        // riskScore, riskLedger, controlMode are now written by applyRiskEdit
      })
      // If we got here due to 503 retries failing, return error instead of question
      const is503 = lastError?.message.includes('503') || lastError?.message.includes('high demand') || lastError?.message.includes('UNAVAILABLE')
      if (is503) {
        return { question: null, final: false, close: null, error: 'AI service is busy (503). Please try again.' }
      }
      return { question: 'I could not understand that. Please try again.', final: false, close: null }
    }

    // ── Normal path: fold THIS answer in first, then decide ─────────────────────────────────────────────────
    const obs = cleanObs(out.coverage)
    if (out.inconsistencies.length) obs.recheck = 'vague'          // a changed story reopens the consistency check
    const echoTarget = isEchoOfName(out.claims?.forWhom, residentName)
    const thisTurn: PlanTurn = {
      obs, claimsOrg: out.claimsOrganisation, personalTie: out.claimsPersonalTie, echoTarget, riskHint: out.riskHint,
    }
    const answeredCount = turns.length + 1
    const after = foldPlan([...planTurns, thisTurn])

    const modelQ = (() => {
      const q = out.nextQuestion
      if (!q) return null
      if (!validQuestion(q, residentName ?? undefined) || hasBannedPhrase(q)) {
        console.warn('[AI interrogator] Model question rejected:', q)
        return null
      }
      if (q.trim().toLowerCase() === asked.trim().toLowerCase()) return null   // never repeat word for word
      return q
    })()

    const satisfied = isSatisfied(after, answeredCount) && out.satisfied && !out.evasive && out.inconsistencies.length === 0
    const modelFocus: Slot | null = isSlot(out.nextFocus) ? out.nextFocus : null

    let nextQuestion: string | null = null
    let focus: Slot | null = null
    if (!satisfied && answeredCount < MAX_TURNS) {
      // Only use AI-generated questions, no scripted fallbacks
      if (modelQ) {
        nextQuestion = modelQ
        focus = modelFocus
      }
    }

    const newTurn: InterrogationTurn = {
      question: asked, transcript: out.transcript, timestamp: Date.now(), next: nextQuestion,
      obs, focus, claimsOrg: out.claimsOrganisation, personalTie: out.claimsPersonalTie, echoTarget, riskHint: out.riskHint,
    }
    const updatedTurns = [...turns, newTurn]

    if (!nextQuestion) {
      await finishInterrogation(householdId, caseId, updatedTurns, satisfied ? 'done' : 'max_turns', out)
      return { question: null, final: true, close: await closeWith(householdId, caseId, 'close') }
    }

    // Risk is updated live after EVERY answer, so helpers see it while the visitor is still at the door.
    const liveText = updatedTurns.map(t => t.transcript).join(' ')
    const live = liveAssessment(liveText, riskMatchesFor(liveText), {
      coverage: coverageFacts(after, answeredCount), inconsistent: out.inconsistencies.length > 0, evasive: out.evasive,
      interviewState: (await getCaseAi(householdId, caseId))?.riskObservations?.interviewState,
    })
    const control = await controlFor(householdId, live)

    // P16: M4 - stop greeter conversation if continuing could raise risk. No negotiating or exceptions.
    // If mode is M4 or higher and we have any confirmed risk events, stop the conversation.
    const newConfirmedBehaviours = live.observations.filter(o => o.state === 'confirmed' && o.source === 'transcript')
    if (modeRank(control.mode) >= modeRank('helper_urgent') && newConfirmedBehaviours.length > 0) {
      const closeLine = await closeWith(householdId, caseId, 'safety')
      await finishInterrogation(householdId, caseId, updatedTurns, 'over_budget', out)
      return { question: null, final: true, close: closeLine }
    }

    // P16: M3 uncertain events - pause questions, play safety script, preserve evidence
    // Evidence is preserved automatically through the observation store (not deleted by cleanup)
    const PHYSICAL_OR_THREAT = ['lock_manipulation', 'door_wedge_or_follow_in', 'immediate_threat', 'forced_entry_or_assault']
    const uncertainObs = live.observations.find(o => o.state === 'uncertain' && PHYSICAL_OR_THREAT.includes(o.code))
    if (modeRank(control.mode) >= modeRank('helper_only') && uncertainObs) {
      // For uncertain physical events, use the uncertain response with safety script
      const uncertainResponse = getUncertainResponse(uncertainObs.code)
      if (uncertainResponse) {
        const d = await dispatchAiAction({ householdId, caseId, tool: uncertainResponse.tool, text: uncertainResponse.response, sEff: control.effectiveScore })
        if (d.allowed) {
          await finishInterrogation(householdId, caseId, updatedTurns, 'over_budget', out)
          return { question: null, final: true, close: d.text }
        }
      }
      const closeLine = await closeWith(householdId, caseId, 'safety')
      await finishInterrogation(householdId, caseId, updatedTurns, 'over_budget', out)
      return { question: null, final: true, close: closeLine }
    }

    // P15: Check for event-specific scripted responses
    // These run in addition to the mode. Each response goes through the dispatcher (gate, audit, stamp).
    for (const obs of newConfirmedBehaviours) {
      const eventResponse = getEventResponse(obs.code)
      if (eventResponse) {
        // Load approved alternative for pressure_after_rule if available
        let approvedAlternative: string | undefined
        if (obs.code === 'pressure_after_rule') {
          const prefs = await getPreferences(householdId)
          approvedAlternative = prefs.approvedAlternative
        }
        const d = await dispatchAiAction({
          householdId, caseId, tool: eventResponse.tool,
          text: renderEventResponse(eventResponse, obs.quotes ?? [], { approvedAlternative }),
          sEff: control.effectiveScore,
        })
        if (d.allowed) {
          // Speak the scripted response instead of the next question
          await finishInterrogation(householdId, caseId, updatedTurns, 'done', out)
          return { question: null, final: true, close: d.text }
        }
      }
    }

    // Spec 4.2: a behaviour that was ignored only because its precondition line never played (rules not explained,
    // boundary not stated, visitor not yet asked to leave) is fixed by playing that fixed line now. The dispatcher
    // stamps it when it is played, so the next repeat can be scored. This replaces guessing stamps from model wording.
    let outgoing: string | null = null
    const missing = live.ledger.find(e => e.state === 'uncertain' && PRECONDITION_LINE[String(e.debug?.why)])
    if (missing) {
      const pre = await dispatchAiAction({ householdId, caseId, line: PRECONDITION_LINE[String(missing.debug?.why)], sEff: control.effectiveScore })
      if (pre.allowed) outgoing = pre.text
    }

    // Spec 5.4: asking the next question is a neutral verification question (cost 41). Over budget -> stop and hand over.
    if (!outgoing) {
      const dq = await dispatchAiAction({ householdId, caseId, tool: 'neutral_verification_question', text: nextQuestion, sEff: control.effectiveScore, decision: 'ask_purpose' })
      if (!dq.allowed) {
        // P7: M3 and above - return the safety line instead of "Thank you. Please wait a moment."
        const closeLine = await closeWith(householdId, caseId, modeRank(control.mode) >= modeRank('helper_only') ? 'safety' : 'close')
        await finishInterrogation(householdId, caseId, updatedTurns, 'over_budget', out)
        return { question: null, final: true, close: closeLine }
      }
      outgoing = dq.text
    }
    newTurn.next = outgoing   // the next turn's "question this answers" is what was actually said
    await setCaseAi(caseId, {
      interrogationTurns: updatedTurns as any, interrogationState: 'asking',
      visitorSummary: out.realReasonSummary ?? undefined,
      riskLevel: live.level, riskFlags: live.labels, riskAssessment: { ...live, control: control } as any,
      // riskScore, riskLedger, controlMode are now written by applyRiskEdit
    })
    return { question: outgoing, final: false, close: null }
  } catch (e) {
    console.error('[AI interrogator] processAnswer failed', e)
    let errorMessage = 'AI service error. Please try again.'
    if (e instanceof Error) {
      if (e.message.includes('503') || e.message.includes('high demand') || e.message.includes('UNAVAILABLE')) {
        errorMessage = 'AI service is temporarily unavailable due to high demand. Please try again in a moment.'
      } else if (e.message.includes('history')) {
        errorMessage = 'Internal error: missing history. Please try again.'
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
  modelResult?: InterrogatorTurnResult
) {
  const finalTurn = turns[turns.length - 1]
  const allTranscripts = turns.map(t => t.transcript).join(' ')

  // Build the interview plan state from the turns
  const planTurns: PlanTurn[] = turns.map(t => ({
    obs: cleanObs(t.obs),
    focus: t.focus,
    claimsOrg: t.claimsOrganisation ?? t.claimsOrg,
    personalTie: t.claimsPersonalTie ?? t.personalTie,
    echoTarget: t.echoTarget,
    riskHint: t.riskHint,
  }))
  const state = foldPlan(planTurns)
  const coverage = coverageSummary(state, turns.length)
  const baseFacts = coverageFacts(state, turns.length)
  // An interview that did not finish satisfied is shown to the helper as a note ("could not be verified"). It adds no risk points.
  const facts = { ...baseFacts, unverifiable: baseFacts.unverifiable || reason !== 'done' }
  const checklistLines = coverageLines(coverage)

  // Layer 1: deterministic keyword rules (+ optional embedding match). Always runs, never fails.
  const ruleFlags = riskFlagsFor(allTranscripts)
  if (!ruleFlags.length) { const s = await semanticFlag(householdId, allTranscripts); if (s) ruleFlags.push(s) }

  // Layer 2: the AI risk judge reads the whole conversation. Layer 3 (in code) combines both and checks the model's quotes.
  const existing = await getCaseAi(householdId, caseId)
  const currentObs = existing?.riskObservations as any
  const interviewState = currentObs?.interviewState ?? {}
  const risk = await assessRisk({
    householdId, caseId,
    turns: turns.map(t => ({ question: t.question, transcript: t.transcript })),
    ruleFlags,
    inconsistencies: modelResult?.inconsistencies ?? [],
    evasive: !!modelResult?.evasive || reason === 'evasive',
    coverageLines: checklistLines,
    coverage: facts,
    interviewState, // P7: Pass interview state to risk assessment
  })
  const flags = risk.labels
  const control = await controlFor(householdId, risk)

  const summary = modelResult?.realReasonSummary || clampWords(finalTurn.transcript || 'Visitor spoke but the reason is unclear.', 30)
  const verdict = modelResult?.verdict || 'unclear'
  const claims = modelResult?.claims || { name: null, organisation: null, reason: null, forWhom: null, time: null }

  // Write the fresh model pass through the single risk writer.
  const { applyRiskEdit } = await import('@/lib/doorstep/caseRiskStore')
  await applyRiskEdit(caseId, {
    kind: 'fresh',
    observations: risk.observations,
    interviewState: interviewState,
  })

  // The remaining fields are still written by setCaseAi (no risk fields).
  await setCaseAi(caseId, {
    visitorSummary: summary,
    riskFlags: flags,
    riskLevel: risk.level,
    riskAssessment: { ...risk, control } as any,
    interrogationTurns: turns as any,
    interrogationVerdict: verdict,
    interrogationClaims: { ...claims, checklist: coverage } as any,
    interrogationState: 'done',
  })
}

/** What the device may ask for right now. It carries NO line text: the words come only from POST /api/ai/interrogator/line,
 *  which runs the dispatcher (gate, audit, stamp). `allowed` is advisory, for the UI. */
export async function interrogatorScript(householdId: string, _residentName: string | null, caseId?: string) {
  const allowed = caseId ? await allowedLines(householdId, caseId) : null   // null = no case to gate against
  return { allowed, listenSeconds: LISTEN_SECONDS, maxTurns: Number.isFinite(MAX_TURNS) ? MAX_TURNS : null }
}
export { wrapPcmAsWav }
