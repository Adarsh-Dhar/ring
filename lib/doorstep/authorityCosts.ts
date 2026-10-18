/**
 * Authority costs (spec 5.4). No imports, so both the controller and the preferences module can use it.
 * The AI may act alone only while cost <= 100 - S_eff, so each ability switches off at a fixed tier edge:
 *   cost 81 -> S_eff <= 19, 61 -> <= 39, 41 -> <= 59, 21 -> <= 79, 1 -> <= 99, 0 -> always.
 */
export const AUTHORITY_COST = {
  read_log_summarise: 0,
  update_status: 0,
  safety_script: 0,
  alert_helper: 0,
  boundary_statement: 1,
  end_conversation: 1,
  restate_rule_refuse: 21,
  neutral_verification_question: 41,
  offer_approved_alternative: 61,
  greet_routine_request: 81,
} as const
export type GatedTool = keyof typeof AUTHORITY_COST

/** Needs a person whatever the score. */
export const HELPER_ONLY_TOOLS = ['policy_exception'] as const
/** Never allowed for anyone at any score. */
export const PROHIBITED_TOOLS = ['unlock_door', 'disclose_access_credentials', 'grant_entry', 'compel_resident_to_open'] as const
