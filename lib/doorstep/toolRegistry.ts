/**
 * Tool registry (spec 9.1). The 14 AI tools, their canonical names, and their authority costs.
 *
 * Spec names and the older names are interchangeable via canonicalTool().
 * Costs are stored in authorityCosts.ts; this file maps spec names to the cost keys.
 *
 * Pure, no imports.
 */

/** The 14 tools from spec 9.1 with their canonical names (older names in comments). */
export const SPEC_TOOLS = {
  report_observation: 'report_observation',
  summarize_evidence: 'summarize_evidence',
  preserve_evidence: 'preserve_evidence',
  escalate_to_backup: 'escalate_to_backup',
  enforce_entry_policy: 'enforce_entry_policy',
  trigger_emergency_workflow: 'trigger_emergency_workflow',
  request_evidence_confirmation: 'request_evidence_confirmation',
  read_log_summarise: 'read_log_summarise',
  update_status: 'update_status',
  safety_script: 'safety_script',
  alert_helper: 'alert_helper',
  emergency_guidance: 'emergency_guidance',
  boundary_statement: 'boundary_statement',
  end_conversation: 'end_conversation',
} as const

export type SpecTool = keyof typeof SPEC_TOOLS

/** Map a spec tool name to its canonical name (the key used in authorityCosts.ts). */
export function canonicalTool(name: string): string {
  // Direct match
  if (name in SPEC_TOOLS) return name

  // Case-insensitive match
  const lower = name.toLowerCase()
  for (const [spec, canonical] of Object.entries(SPEC_TOOLS)) {
    if (spec.toLowerCase() === lower) return canonical
  }

  // Return unknown as-is (will be refused by executeAiToolCall)
  return name
}

/** All known tool names (for validation). */
export const KNOWN_TOOLS = new Set(Object.keys(SPEC_TOOLS))
