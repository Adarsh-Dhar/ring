/**
 * The interviewer's playbook: the tactics it may use and the rules for when each is allowed.
 *
 * The MODEL proposes the next move (a tactic, an objective, a reason) and writes the words. CODE decides whether
 * the move is allowed right now. This is the line between "agent" and "script": nothing here is a question, it is
 * policy about which kind of move is legitimate in which state, taken from the SUE / PEACE / ORBIT research:
 *
 *  - Withhold, then commit, then check (SUE). Nothing is put to the visitor before they have committed to an account.
 *  - Never press a declined question. A decline gets autonomy support (ORBIT), and a second decline ends the interview.
 *  - A challenge is only ever a neutral clarification, and only about something that really was inconsistent.
 *  - Evidence is only ever a visitor-side fact, one at a time, low specificity first (EFM).
 *  - Do not repeat the same move twice in a row.
 */
import { TACTICS, type Tactic, type Move, type CounterTactic } from './schemas'
import { MAX_CONSECUTIVE_DECLINES, type CaseFile } from './casefile'
import type { Slot } from './plan'
import type { EvidenceItem } from './evidence'

export const TACTIC_INTENT: Record<Tactic, string> = {
  probe_specifics: 'Narrow what they said to who / what / where / when, using their own words. Do not reveal what you know.',
  commit_closed: 'Ask one yes/no question that locks them to a claim they made, so any later change is visible.',
  unanticipated_logistics: 'Ask how, when or from where they came (route, vehicle, where they set off, last stop). A rehearsed story rarely covers this.',
  reverse_order: 'Ask them to go back over the last hour starting from the most recent thing. Honest memory copes with this; a prepared script does not.',
  verification_request: 'Ask for one independently checkable thing: a reference or work-order number, a supervisor name, an office number the household can call, ID held to the camera.',
  consistency_clarify: 'Quote two of their OWN statements that differ and ask which is right, so you record it correctly. No accusation, no tone of surprise.',
  evidence_frame: 'State exactly one visitor-side fact you were given (what the doorbell camera sees) and invite them to explain or confirm. Never add or imply anything else.',
  autonomy_support: 'They declined or deflected. Say it is their choice, that they do not have to answer, and invite them to say whatever they are comfortable with. Do not press.',
  confirm_summary: 'Repeat back, in one sentence, what they have told you and ask whether that is right.',
  clarify_audio: 'You could not make out the answer. Ask them to say it again.',
  close: 'You have what the carers need, or the visitor has made clear they will not say more. End politely.',
}

export interface MoveContext {
  file: CaseFile
  /** Could the last answer be understood? */
  understood: boolean
  /** Set when the last answer declined, deflected, answered a question with a question, was hostile or pressured. */
  counterTactic: CounterTactic | null
  /** The next visitor-side fact the interviewer is allowed to state, if any. */
  fact: EvidenceItem | null
  /** Questions the authority gate will still allow, or null if there is no fixed limit. */
  questionsLeft: number | null
}

const isSpecific = (f: CaseFile, k: Slot) => f.latest[k]?.specificity === 'specific'

export function allowedTactics(ctx: MoveContext): Tactic[] {
  const f = ctx.file
  if (!ctx.understood) return ['clarify_audio']
  if (f.consecutiveDeclines >= MAX_CONSECUTIVE_DECLINES) return ['close']
  if (ctx.counterTactic) return ['autonomy_support', 'close']

  const ok = new Set<Tactic>(TACTICS)
  ok.delete('clarify_audio')
  ok.delete('autonomy_support')                       // only a response to a decline

  if (!f.open.length) ok.delete('consistency_clarify')
  if (!ctx.fact || f.commitments.length < 1) ok.delete('evidence_frame')            // commit first, then check
  if (f.latest.proof?.specificity === 'refused' || f.asks.proof >= 2) ok.delete('verification_request')   // never press a declined ask
  if (isSpecific(f, 'spatial') && f.asks.spatial >= 1) ok.delete('unanticipated_logistics')
  if (f.commitments.length < 2) ok.delete('reverse_order')
  if (f.answered < 1) ok.delete('confirm_summary')

  ok.add('close')
  return TACTICS.filter(t => ok.has(t))
}

/** Used only when the model's proposal is missing or not allowed. A policy over the state, not a script of words. */
const FALLBACK_ORDER: Tactic[] = ['clarify_audio', 'autonomy_support', 'consistency_clarify', 'verification_request', 'unanticipated_logistics', 'probe_specifics', 'confirm_summary', 'close']

export function defaultObjective(t: Tactic, f: CaseFile): Slot | null {
  switch (t) {
    case 'verification_request': return 'proof'
    case 'unanticipated_logistics': return 'spatial'
    case 'consistency_clarify': return f.open[0]?.topic ?? null
    case 'probe_specifics': return (['purpose', 'detail', 'name'] as Slot[]).find(k => !isSpecific(f, k)) ?? 'purpose'
    default: return null
  }
}

export interface ChosenMove { move: Move; overridden: boolean; note: string; allowed: Tactic[] }

export function chooseMove(proposed: Move | null, ctx: MoveContext): ChosenMove {
  const allowed = allowedTactics(ctx)
  // The same move on the same objective twice in a row is a repeat. (A new inconsistency may be clarified again.)
  const last = ctx.file.moves[ctx.file.moves.length - 1]
  const repeat = !!proposed && !!last && last.tactic === proposed.tactic && last.objective === proposed.objective
    && proposed.tactic !== 'consistency_clarify' && proposed.tactic !== 'close'
  if (proposed && allowed.includes(proposed.tactic) && !repeat) {
    return { move: proposed, overridden: false, note: '', allowed }
  }
  const usable = repeat ? allowed.filter(t => t !== proposed!.tactic) : allowed
  const tactic = FALLBACK_ORDER.find(t => usable.includes(t)) ?? 'close'
  const note = proposed
    ? `Proposed ${proposed.tactic}${repeat ? ' repeats the last move' : ' is not allowed in this state'}; used ${tactic}`
    : `No valid move proposed; used ${tactic}`
  return { move: { tactic, objective: defaultObjective(tactic, ctx.file), rationale: 'playbook default' }, overridden: true, note, allowed }
}

/** Tactic list shown to the model: only what is allowed now, with the intent of each. */
export const playbookText = (allowed: Tactic[]): string => allowed.map(t => `- ${t}: ${TACTIC_INTENT[t]}`).join('\n')
