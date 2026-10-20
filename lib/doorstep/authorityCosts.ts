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
  emergency_guidance: 0,
  boundary_statement: 1,
  end_conversation: 1,
  restate_rule_refuse: 21,
  neutral_verification_question: 41,
  offer_approved_alternative: 61,
  greet_routine_request: 81,
  // Spec 9.1 new tools
  report_observation: 0,
  summarize_evidence: 0,
  preserve_evidence: 0,
  escalate_to_backup: 0,
  enforce_entry_policy: 0,
  trigger_emergency_workflow: 0,
  request_evidence_confirmation: 0,
} as const
export type GatedTool = keyof typeof AUTHORITY_COST

/** Needs a person whatever the score. */
export const HELPER_ONLY_TOOLS = ['policy_exception'] as const
/** Only allowed at S_eff 100 (emergency mode, spec 6.2 M5: "only pre-approved emergency guidance").
 * Zero-cost internal tools (read_log_summarise, update_status, alert_helper) are NOT listed: the helper is notified from M1 and
 * the AI gives factual summaries at M3, so they must stay available at every score (spec 6.2). */
export const EMERGENCY_ONLY_TOOLS = ['emergency_guidance'] as const
/** Never allowed for anyone at any score. Spec 9.3: also covers labelling a visitor dangerous/criminal, emergency services on a score, silence as consent. */
export const PROHIBITED_TOOLS = [
  'unlock_door',
  'disclose_access_credentials',
  'grant_entry',
  'compel_resident_to_open',
  'label_visitor_dangerous',
  'label_visitor_criminal',
  'call_emergency_services_on_score',
  'silence_as_consent',
] as const
