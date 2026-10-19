/**
 * The action gate (spec 5.4). Runs in backend code, never in a prompt.
 *   AI acts alone  <=>  cost(a) <= 100 - S_eff   and no resident restriction or prohibition applies.
 * Order of checks: prohibited -> helper-only -> emergency-only -> resident restriction -> budget.
 */
import { AUTHORITY_COST, HELPER_ONLY_TOOLS, PROHIBITED_TOOLS, EMERGENCY_ONLY_TOOLS, type GatedTool } from './authorityCosts'
import type { Decision, Preferences } from './residentPreferences'

export type GateDecision = 'allow' | 'ask_helper' | 'deny'
export interface GateResult { decision: GateDecision; reason: string; cost: number | null; budget: number }

/** Which resident delegation, if any, restricts a tool. Safety tools (boundary, end, holding script) are never restricted. */
const RESIDENT_DECISION: Partial<Record<GatedTool, Decision>> = {
  greet_routine_request: 'greet_visitor',
  neutral_verification_question: 'ask_purpose',
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : 0)))

/** `holdOnly`: an approval is pending (spec 5.3), so the AI may use only its holding script and other zero-cost tools.
 *  `decision`: the resident delegation this action exercises when the tool alone is ambiguous (ask_for_id, accept_parcel,
 *  tell_visitor_to_leave). Spec 5.4: a resident restriction always overrides the number.
 *  `safetyOnly`: Section 7.2 - when helper-led with no helper answering, AI is limited to safety scripts. */
export function gateAction(tool: string, sEff: number, prefs?: Preferences, opts: { holdOnly?: boolean; decision?: Decision; safetyOnly?: boolean } = {}): GateResult {
  const budget = 100 - clamp(sEff)
  if ((PROHIBITED_TOOLS as readonly string[]).includes(tool)) return { decision: 'deny', reason: 'prohibited', cost: null, budget }
  if ((HELPER_ONLY_TOOLS as readonly string[]).includes(tool)) return { decision: 'ask_helper', reason: 'helper_only', cost: null, budget }
  if (!(tool in AUTHORITY_COST)) return { decision: 'deny', reason: 'unknown_tool', cost, null, budget }
  const cost = AUTHORITY_COST[tool as GatedTool]
  // Emergency-only tools: allowed only at S_eff 100
  if ((EMERGENCY_ONLY_TOOLS as readonly string[]).includes(tool)) {
    if (sEff < 100) return { decision: 'deny', reason: 'emergency_only', cost, budget }
  }
  const d = opts.decision ?? RESIDENT_DECISION[tool as GatedTool]
  if (opts.holdOnly && cost > 0) return { decision: 'ask_helper', reason: 'approval_pending', cost, budget }
  if (opts.safetyOnly && cost > 0) return { decision: 'ask_helper', reason: 'safety_only', cost, budget }
  if (prefs && d && prefs.delegation[d] !== 'ai') return { decision: 'ask_helper', reason: `resident_restriction:${d}`, cost, budget }
  if (cost > budget) return { decision: 'ask_helper', reason: 'over_budget', cost, budget }
  return { decision: 'allow', reason: 'within_budget', cost, budget }
}

/** Fixed talkback line -> the tool it uses. */
export const LINE_TOOL = {
  greet: 'greet_routine_request',
  reprompt: 'neutral_verification_question',
  close: 'safety_script',
  safety: 'safety_script',
  emergency_guidance: 'emergency_guidance',
  holding: 'safety_script',
  rules_explained: 'restate_rule_refuse',
  boundary_stated: 'boundary_statement',
  asked_to_leave: 'end_conversation',
  entry_not_permitted: 'boundary_statement',
} as const satisfies Record<string, GatedTool>
