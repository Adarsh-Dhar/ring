/**
 * Collaboration controller (spec sections 1, 2 and 5): who leads, how much the AI may do, and the timers.
 *
 * Pure, no imports apart from the other doorstep modules. Every score value gets its own autonomy budget,
 * oversight index, helper priority and timers (no hidden buckets). Permitted actions change only at the mode edges.
 *
 * Section 5: every value comes from the EFFECTIVE score S_eff = max(S, floor score of the event minimum mode).
 */
import { CONTROL_MODES, maxMode, modeRank, type ControlMode } from './riskRules'
import { permittedActions, type Permissions, type Preferences } from './residentPreferences'
import { AUTHORITY_COST } from './authorityCosts'

/** Score at which the control mode rises by itself (before any event floor). Pilot starting values.
 * Step 6 (Option A): emergency is now reserved for score 100 (forced entry / SOS / confirmed assault).
 * Score 80–99 maps to helper_only, matching the immediate_threat floor. */
export const MODE_THRESHOLDS: { atLeast: number; mode: ControlMode }[] = [
  { atLeast: 100, mode: 'emergency' },
  { atLeast: 60,  mode: 'helper_only' },
  { atLeast: 40,  mode: 'helper_leads' },
  { atLeast: 20,  mode: 'ai_assisted' },
  { atLeast: 0,   mode: 'ai_leads' },
]

export function modeForScore(score: number): ControlMode {
  const s = Math.max(0, Math.min(100, Math.round(score)))
  return MODE_THRESHOLDS.find(t => s >= t.atLeast)!.mode
}

/** Lowest score of each mode: the floor score a minimum mode contributes to S_eff (spec 5, first paragraph).
 * Derived from MODE_THRESHOLDS so there is one source of truth. Confirm the helper-led value against section 6.3. */
export const MODE_FLOOR_SCORE = Object.fromEntries(MODE_THRESHOLDS.map(t => [t.mode, t.atLeast])) as Record<ControlMode, number>

const clampScore = (n: number) => Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : 0)))

/** S_eff = max(S, event floor). With no serious event active the floor is 0, so S_eff = S. */
export function effectiveScore(score: number, minMode?: ControlMode | null): number {
  return Math.max(clampScore(score), MODE_FLOOR_SCORE[minMode ?? 'ai_leads'])
}

/** Spec 5.3. Pilot defaults, not validated. */
export const DEFAULT_APPROVAL_SECONDS = 120
export const RISK_TIMER_BASE = 120
export const TAKEOVER_CAP_SECONDS = 60

export interface Timers {
  /** A resident rule needs helper approval (any score, including 0). Set by the resident. */
  approvalSec: number
  /** 120 - S_eff for 1 <= S_eff <= 99, otherwise null (0 is not risk-driven, 100 is an emergency). */
  riskDecisionSec: number | null
  /** min(120 - S_eff, 60) when helper-led (S_eff >= 60 or an event minimum of helper-led), otherwise null. */
  takeoverSec: number | null
  /** Emergency has no timer: primary and backup are alerted together. */
  emergency: null
}

export function timersFor(sEff: number, minMode?: ControlMode | null, approvalSec: number = DEFAULT_APPROVAL_SECONDS): Timers {
  const s = clampScore(sEff)
  const helperLed = s >= 60 || modeRank(minMode ?? 'ai_leads') >= modeRank('helper_leads')
  return {
    approvalSec: Number.isFinite(approvalSec) && approvalSec > 0 ? Math.round(approvalSec) : DEFAULT_APPROVAL_SECONDS,
    riskDecisionSec: s >= 1 && s <= 99 ? RISK_TIMER_BASE - s : null,
    takeoverSec: helperLed && s < 100 ? Math.min(RISK_TIMER_BASE - s, TAKEOVER_CAP_SECONDS) : null,
    emergency: null,
  }
}

export type TimerKind = 'approval' | 'risk_decision' | 'takeover' | 'emergency'

/** Which timer governs now. When several apply, the shortest wins (a person is needed for more than one reason). */
export function activeTimer(
  t: Timers,
  ctx: { needsApproval?: boolean; riskDecisionNeeded?: boolean; emergency?: boolean } = {},
): { kind: TimerKind; seconds: number | null } | null {
  if (ctx.emergency) return { kind: 'emergency', seconds: null }
  const c: { kind: TimerKind; seconds: number }[] = []
  if (ctx.needsApproval) c.push({ kind: 'approval', seconds: t.approvalSec })
  if (t.takeoverSec !== null) c.push({ kind: 'takeover', seconds: t.takeoverSec })
  if (ctx.riskDecisionNeeded && t.riskDecisionSec !== null) c.push({ kind: 'risk_decision', seconds: t.riskDecisionSec })
  return c.length ? c.reduce((a, b) => (b.seconds < a.seconds ? b : a)) : null
}

/** Spec 5.3: a helper decision is needed because of the score once the cheapest routine action no longer fits the budget.
 *  greet_routine_request costs 81, so this is true from S_eff 20. Below that the AI handles the visit alone. */
export function riskDecisionNeeded(sEff: number): boolean {
  return AUTHORITY_COST.greet_routine_request > 100 - clampScore(sEff)
}

/** Section 7.2 (nobody in the chain answers) keeps its own curve. Unchanged from before. */
export const NO_RESPONSE_CURVE = { atZero: 300, atMax: 90, min: 90 } as const
const noResponse = (s: number) => Math.max(NO_RESPONSE_CURVE.min, Math.round(NO_RESPONSE_CURVE.atZero + (NO_RESPONSE_CURVE.atMax - NO_RESPONSE_CURVE.atZero) * (s / 100)))

/** Dashboard order (spec 5.2): S_eff, then event severity, then the most recent event first. */
export function compareForDashboard(
  a: { effectiveScore: number; eventSeverity: number; lastEventAt: number },
  b: { effectiveScore: number; eventSeverity: number; lastEventAt: number },
): number {
  return b.effectiveScore - a.effectiveScore || b.eventSeverity - a.eventSeverity || b.lastEventAt - a.lastEventAt
}

export interface Control {
  /** S_eff, the effective score. Every value below comes from it. */
  score: number
  effectiveScore: number
  /** The confirmed behaviour score S before any event floor. */
  rawScore: number
  mode: ControlMode
  /** Severity of the event-set minimum mode (0 = none). Second key of the dashboard order. */
  eventSeverity: number
  /** 100 minus S_eff: how much room the AI has to act alone. */
  aiAutonomyBudget: number
  /** Equal to S_eff: how closely a person should watch. */
  humanOversightIndex: number
  /** Dashboard rank. Higher means look at this case first: S_eff, then event severity. */
  helperPriority: number
  timers: Timers
  /** Section 7.2 timer. */
  noResponseSeconds: number
  permissions: Permissions
  /** Plain sentence for the case log and the helper screen. */
  summary: string
}

const LEADS: Record<ControlMode, string> = {
  ai_leads: 'The assistant leads. The helper can see everything.',
  ai_assisted: 'The assistant leads with the helper watching.',
  helper_leads: 'The helper leads. The assistant only helps and reports.',
  helper_only: 'The helper is in charge. The assistant stays quiet unless asked.',
  emergency: 'Emergency. The helper and emergency contacts are being alerted.',
}

export function computeControl(input: { score: number; minMode?: ControlMode | null; prefs: Preferences; approvalSec?: number }): Control {
  const rawScore = clampScore(input.score)
  const sEff = effectiveScore(rawScore, input.minMode)
  // Events outrank the score: the mode is never lower than the floor an event set.
  const mode = maxMode(modeForScore(sEff), input.minMode ?? 'ai_leads')
  const eventSeverity = modeRank(input.minMode ?? 'ai_leads')
  return {
    score: sEff, effectiveScore: sEff, rawScore, mode, eventSeverity,
    aiAutonomyBudget: 100 - sEff,
    humanOversightIndex: sEff,
    helperPriority: sEff * 10 + eventSeverity,
    timers: timersFor(sEff, input.minMode, input.approvalSec),
    noResponseSeconds: noResponse(sEff),
    permissions: permittedActions(input.prefs, mode, sEff),
    summary: LEADS[mode],
  }
}
