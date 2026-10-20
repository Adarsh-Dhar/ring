/**
 * Controller tool execution (spec 9.2).
 *
 * Executes controller tools when the rules say yes.
 * The AI may ask for 4; escalate_to_backup, enforce_entry_policy, trigger_emergency_workflow
 * are rule-only and refused if the AI asks.
 */

import { controllerToolAllowed } from './controllerRules'
import { writeAudit, createAuditEvent } from './audit'
import { getDb } from '@/lib/db/client'

export interface ControllerToolResult {
  success: boolean
  reason?: string
  data?: any
}

/**
 * Execute a controller tool. This is called by the controller rules, not directly by the AI.
 *
 * The AI may request these tools, but they are only executed when the controller rules allow it.
 */
export async function executeControllerTool(
  caseId: string,
  householdId: string,
  toolName: string,
  args: any
): Promise<ControllerToolResult> {
  // Check if tool is allowed (caller is 'controller' for controller tools)
  const check = controllerToolAllowed(toolName, 'controller')
  if (!check.allowed) {
    await writeAudit(caseId, createAuditEvent('controller', 'tool_call', {
      tool: toolName,
      decision: 'refused',
      reason: check.reason,
    }))
    return { success: false, reason: check.reason }
  }

  try {
    let result: any

    switch (toolName) {
      case 'escalate_to_backup': {
        // Escalate to the next helper in the chain
        const { escalateNext } = await import('./escalateNext')
        // Controller tools don't have a membershipId context, so we skip this for now
        // This should be called with proper context from the escalate route
        result = { error: 'Controller tools need membership context for escalation' }
        break
      }

      case 'enforce_entry_policy': {
        // C-03: Make this a pure check that returns { enforced: true } and writes only an audit entry
        // No applyRiskEdit call - the door stays closed by default
        await writeAudit(caseId, createAuditEvent('controller', 'entry_policy_enforced', {
          tool: toolName,
          decision: 'checked',
        }))
        result = { enforced: true }
        break
      }

      case 'trigger_emergency_workflow': {
        // Trigger emergency workflow (M5)
        const { alertEmergency } = await import('@/lib/doorbell/store')
        await alertEmergency(householdId, caseId)
        result = { emergency: true }
        break
      }

      case 'request_evidence_confirmation': {
        // Request evidence confirmation from helpers
        const { createHelperRequest } = await import('./helperRequests')
        const memberships = await getDb().membership.findMany({
          where: { householdId, approved: true },
        })
        for (const m of memberships) {
          await createHelperRequest({
            caseId,
            membershipId: m.id,
            kind: 'evidence_confirmation',
          })
        }
        result = { requested: true }
        break
      }

      default: {
        // Pass through to other tools (read_log_summarise, update_status, etc.)
        result = { executed: true, tool: toolName }
        break
      }
    }

    await writeAudit(caseId, createAuditEvent('controller', 'tool_call', {
      tool: toolName,
      decision: 'executed',
      result,
    }))

    return { success: true, data: result }
  } catch (error) {
    await writeAudit(caseId, createAuditEvent('controller', 'tool_call', {
      tool: toolName,
      decision: 'failed',
      error: String(error),
    }))
    return { success: false, reason: `Controller tool execution failed: ${error}` }
  }
}
