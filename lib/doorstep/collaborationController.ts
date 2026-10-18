/**
 * Collaboration controller (spec sections 1, 2 and 5): who leads, how much the AI may do, and the timers.
 *
 * Pure, no imports apart from the other doorstep modules. Every score value gets its own autonomy budget,
 * oversight index, helper priority and timers (no hidden buckets). Permitted actions change only at the mode edges.
 *
 * P7: Timer values from Section 5.3 are implemented (60s/180s/300s at score 0, shrinking to 10s/45s/90s at score 100).
 */
import { CONTROL_MODES, maxMode, type ControlMode } from './riskRules'
import { permittedActions, type Permissions, type Preferences } from './residentPreferences'

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

/**
 * Three SEPARATE timers (replacing one acknowledgement formula whose floor could never be reached).
 *  ackSeconds      : how long a helper has to acknowledge the alert before the next helper is tried
 *  decisionSeconds : how long an acknowledged helper has to decide before they are asked again
 *  noResponseSeconds: how long until a helper who never answers is treated as no-response (never as consent)
 * Each shrinks as the score grows but never below its own floor, which every score value can reach.
 */
export const TIMER_CURVE = {
  ackSeconds:        { atZero: 60,  atMax: 10,  min: 10 },
  decisionSeconds:   { atZero: 180, atMax: 45,  min: 45 },
  noResponseSeconds: { atZero: 300, atMax: 90,  min: 90 },
} as const

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const timer = (c: { atZero: number; atMax: number; min: number }, score: number) => Math.max(c.min, Math.round(lerp(c.atZero, c.atMax, score / 100)))

export interface Control {
  score: number
  mode: ControlMode
  /** 100 minus the score: how much room the AI has to act alone. */
  aiAutonomyBudget: number
  /** Equal to the score: how closely a person should watch. */
  humanOversightIndex: number
  /** Dashboard rank. Higher means look at this case first. Ties go to the higher mode. */
  helperPriority: number
  timers: { ackSeconds: number; decisionSeconds: number; noResponseSeconds: number }
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

export function computeControl(input: { score: number; minMode?: ControlMode | null; prefs: Preferences }): Control {
  const score = Math.max(0, Math.min(100, Math.round(Number.isFinite(input.score) ? input.score : 0)))
  // Events outrank the score: the mode is never lower than the floor an event set.
  const mode = maxMode(modeForScore(score), input.minMode ?? 'ai_leads')
  return {
    score, mode,
    aiAutonomyBudget: 100 - score,
    humanOversightIndex: score,
    helperPriority: score + CONTROL_MODES.indexOf(mode) * 1000,
    timers: {
      ackSeconds: timer(TIMER_CURVE.ackSeconds, score),
      decisionSeconds: timer(TIMER_CURVE.decisionSeconds, score),
      noResponseSeconds: timer(TIMER_CURVE.noResponseSeconds, score),
    },
    permissions: permittedActions(input.prefs, mode),
    summary: LEADS[mode],
  }
}
