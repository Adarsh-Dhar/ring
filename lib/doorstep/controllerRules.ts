/**
 * Controller tool rules (spec 9.2).
 *
 * The AI may ask for 4 controller tools:
 * - escalate_to_backup
 * - enforce_entry_policy
 * - trigger_emergency_workflow
 * - request_evidence_confirmation
 *
 * However, escalate_to_backup, enforce_entry_policy, and trigger_emergency_workflow
 * are rule-only and refused if the AI asks directly. Only the controller rules can execute them.
 */

export interface ControllerToolCheck {
  allowed: boolean
  reason?: string
}

/**
 * Check if a controller tool is allowed to be executed by the AI.
 *
 * Rule-only tools (escalate_to_backup, enforce_entry_policy, trigger_emergency_workflow)
 * return false when the AI asks. They can only be executed by the controller rules.
 */
export function controllerToolAllowed(toolName: string): ControllerToolCheck {
  const RULE_ONLY_TOOLS = [
    'escalate_to_backup',
    'enforce_entry_policy',
    'trigger_emergency_workflow',
  ]

  if (RULE_ONLY_TOOLS.includes(toolName)) {
    return {
      allowed: false,
      reason: `Tool is rule-only and cannot be called by AI: ${toolName}`,
    }
  }

  // request_evidence_confirmation is allowed
  if (toolName === 'request_evidence_confirmation') {
    return { allowed: true }
  }

  // Other tools are handled by their own rules
  return { allowed: true }
}

/**
 * Tools that the AI may request but are rule-only.
 */
export const RULE_ONLY_CONTROLLER_TOOLS = [
  'escalate_to_backup',
  'enforce_entry_policy',
  'trigger_emergency_workflow',
] as const
