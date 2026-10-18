/**
 * Resident preferences (spec sections 1 and 2): which decisions the AI handles, which need a helper,
 * communication and sensory settings, and the hard rules that never change.
 *
 * Pure, no imports. Defaults reproduce today's behaviour: the AI is advisory, helpers decide, nothing unlocks.
 */
import type { ControlMode } from './riskRules'
import { AUTHORITY_COST, type GatedTool } from './authorityCosts'

export const DECISIONS = ['greet_visitor', 'ask_purpose', 'ask_for_id', 'tell_visitor_to_leave', 'accept_parcel', 'approve_short_notice'] as const
export type Decision = (typeof DECISIONS)[number]
export type Delegate = 'ai' | 'helper' | 'resident_only'

export const ACTIONS = [
  'greet_visitor', 'ask_purpose', 'ask_for_id', 'tell_visitor_to_leave', 'notify_helper',
  'request_helper_approval', 'authorise_visit_procedure', 'accept_parcel', 'sound_alarm', 'call_emergency',
] as const
export type Action = (typeof ACTIONS)[number]

/** Never permitted, for anyone, at any score. The AI never opens the door and never discloses access credentials. */
export const ALWAYS_PROHIBITED = ['unlock_door', 'disclose_access_credentials', 'grant_entry', 'compel_resident_to_open'] as const

export interface Preferences {
  /** Who handles each decision while the AI is allowed to lead. */
  delegation: Record<Decision, Delegate>
  communication: { sensory: 'low' | 'standard'; plainWordsOnly: boolean; textOnly: boolean; speakingPace: 'slow' | 'normal' }
  /** Entry without approval is not permitted in this design. Kept as data so a screen can show it. */
  entryWithoutApproval: 'never'
}

export const DEFAULT_PREFERENCES: Preferences = {
  delegation: {
    greet_visitor: 'ai', ask_purpose: 'ai', ask_for_id: 'ai',
    tell_visitor_to_leave: 'helper', accept_parcel: 'helper', approve_short_notice: 'helper',
  },
  communication: { sensory: 'low', plainWordsOnly: true, textOnly: false, speakingPace: 'slow' },
  entryWithoutApproval: 'never',
}

const isDelegate = (v: unknown): v is Delegate => v === 'ai' || v === 'helper' || v === 'resident_only'

/** Tolerant read of the stored JSON. Anything missing or invalid falls back to the default. */
export function parsePreferences(raw: unknown): Preferences {
  const o = (raw && typeof raw === 'object' ? raw : {}) as any
  const delegation = { ...DEFAULT_PREFERENCES.delegation }
  for (const d of DECISIONS) if (isDelegate(o.delegation?.[d])) delegation[d] = o.delegation[d]
  const c = o.communication ?? {}
  return {
    delegation,
    communication: {
      sensory: c.sensory === 'standard' ? 'standard' : 'low',
      plainWordsOnly: typeof c.plainWordsOnly === 'boolean' ? c.plainWordsOnly : DEFAULT_PREFERENCES.communication.plainWordsOnly,
      textOnly: typeof c.textOnly === 'boolean' ? c.textOnly : DEFAULT_PREFERENCES.communication.textOnly,
      speakingPace: c.speakingPace === 'normal' ? 'normal' : 'slow',
    },
    entryWithoutApproval: 'never',
  }
}

export interface Permissions {
  allowed: Action[]
  /** Needs a person, not the AI, before it can happen. */
  needsHelper: Action[]
  prohibited: string[]
}

const AI_ACTIONS: { action: Action; decision: Decision }[] = [
  { action: 'greet_visitor', decision: 'greet_visitor' },
  { action: 'ask_purpose', decision: 'ask_purpose' },
  { action: 'ask_for_id', decision: 'ask_for_id' },
  { action: 'tell_visitor_to_leave', decision: 'tell_visitor_to_leave' },
  { action: 'accept_parcel', decision: 'accept_parcel' },
]

/** Which gated tool each AI action uses (section 5.4). */
export const ACTION_TOOL: Record<'greet_visitor' | 'ask_purpose' | 'ask_for_id' | 'tell_visitor_to_leave' | 'accept_parcel', GatedTool> = {
  greet_visitor: 'greet_routine_request',
  ask_purpose: 'neutral_verification_question',
  ask_for_id: 'neutral_verification_question',
  tell_visitor_to_leave: 'boundary_statement',
  accept_parcel: 'greet_routine_request',
}

/**
 * What may happen next, given the control mode. The resident's own "keep closed" and SOS are not listed here
 * because they are always available and are never gated by a mode, a score or a preference.
 *
 *  - ai_leads / ai_assisted: the AI may do what the resident delegated to it. Everything else waits for a helper.
 *  - helper_leads and above: the AI stops acting on its own. It only notifies, reports and helps the helper.
 *  - emergency: alarm and emergency call are also allowed.
 */
/** With `sEff` the budget rule decides (cost <= 100 - S_eff). Without it, the old mode rule applies. */
export function permittedActions(prefs: Preferences, mode: ControlMode, sEff?: number): Permissions {
  const allowed: Action[] = ['notify_helper']
  const needsHelper: Action[] = ['request_helper_approval', 'authorise_visit_procedure']
  const aiMayAct = mode === 'ai_leads' || mode === 'ai_assisted'

  for (const { action, decision } of AI_ACTIONS) {
    const fits = sEff === undefined ? aiMayAct : mode !== 'emergency' && AUTHORITY_COST[ACTION_TOOL[action]] <= 100 - sEff
    if (fits && prefs.delegation[decision] === 'ai') allowed.push(action)
    else needsHelper.push(action)
  }
  if (mode === 'emergency') allowed.push('sound_alarm', 'call_emergency')
  else needsHelper.push('sound_alarm')

  return { allowed, needsHelper, prohibited: [...ALWAYS_PROHIBITED] }
}
