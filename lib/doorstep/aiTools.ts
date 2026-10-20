/**
 * AI tool entry point (spec 9.1). executeAiToolCall() is the single function that handles
 * all AI tool requests, validates inputs, checks rules, and executes or refuses.
 *
 * Unknown tool names are refused and logged.
 */

import { canonicalTool, KNOWN_TOOLS } from './toolRegistry'
import { validateObservationInput, buildEvidenceSummary } from './toolInputs'
import { controllerToolAllowed, executeControllerTool } from './controllerTools'
import { PROHIBITED_TOOLS, HELPER_ONLY_TOOLS, EMERGENCY_ONLY_TOOLS } from './authorityCosts'
import { writeAudit, createAuditEvent } from './audit'
import { markAiUnavailable } from './analysisAvailability'
import { getPrivacySettings } from './privacy'
import { getDb } from '@/lib/db/client'

export interface ToolCallResult {
  success: boolean
  reason?: string
  data?: any
}

/**
 * Execute an AI tool call. This is the single entry point for all AI tool requests.
 *
 * Steps:
 * 1. Resolve tool name via canonicalTool()
 * 2. Refuse unknown tools and log
 * 3. Validate inputs
 * 4. Check prohibited/helper-only/emergency-only rules
 * 5. Execute or refuse with audit log
 */
export async function executeAiToolCall(
  caseId: string,
  householdId: string,
  toolName: string,
  args: any
): Promise<ToolCallResult> {
  const canonical = canonicalTool(toolName)

  // Step 1: Refuse unknown tools
  if (!KNOWN_TOOLS.has(canonical)) {
    await writeAudit(caseId, createAuditEvent('ai', 'tool_call', {
      tool: toolName,
      canonical,
      decision: 'refused',
      reason: 'unknown_tool',
    }))
    return { success: false, reason: `Unknown tool: ${toolName}` }
  }

  // Step 2: Check prohibited tools
  if (PROHIBITED_TOOLS.includes(canonical as any)) {
    await writeAudit(caseId, createAuditEvent('ai', 'tool_call', {
      tool: canonical,
      decision: 'refused',
      reason: 'prohibited',
    }))
    return { success: false, reason: `Tool is prohibited: ${canonical}` }
  }

  // Step 3: Check helper-only tools
  if (HELPER_ONLY_TOOLS.includes(canonical as any)) {
    await writeAudit(caseId, createAuditEvent('ai', 'tool_call', {
      tool: canonical,
      decision: 'refused',
      reason: 'helper_only',
    }))
    return { success: false, reason: `Tool requires helper approval: ${canonical}` }
  }

  // Step 4: Check emergency-only tools
  if (EMERGENCY_ONLY_TOOLS.includes(canonical as any)) {
    const c = await getDb().case.findUnique({
      where: { id: caseId },
      select: { controlMode: true, riskScore: true },
    })
    const isEmergency = c?.controlMode === 'emergency' || c?.riskScore === 100
    if (!isEmergency) {
      await writeAudit(caseId, createAuditEvent('ai', 'tool_call', {
        tool: canonical,
        decision: 'refused',
        reason: 'emergency_only',
      }))
      return { success: false, reason: `Tool only allowed in emergency mode: ${canonical}` }
    }
  }

  // Step 5: Check controller tool rules
  const controllerCheck = controllerToolAllowed(canonical)
  if (!controllerCheck.allowed) {
    await writeAudit(caseId, createAuditEvent('ai', 'tool_call', {
      tool: canonical,
      decision: 'refused',
      reason: controllerCheck.reason,
    }))
    return { success: false, reason: controllerCheck.reason }
  }

  // Step 6: Execute based on tool type
  try {
    let result: any

    switch (canonical) {
      case 'report_observation': {
        const validation = validateObservationInput(args)
        if (!validation.valid) {
          await writeAudit(caseId, createAuditEvent('ai', 'tool_call', {
            tool: canonical,
            decision: 'refused',
            reason: validation.reason,
          }))
          return { success: false, reason: validation.reason }
        }
        // Store the observation via caseRiskStore
        const { applyRiskEdit } = await import('./caseRiskStore')
        await applyRiskEdit(caseId, {
          kind: 'append',
          observation: validation.observation,
        })
        result = { observation: validation.observation }

        // Auto-request evidence confirmation for uncertain observations
        if (validation.observation.state === 'uncertain') {
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
        }
        break
      }

      case 'summarize_evidence': {
        result = buildEvidenceSummary(caseId)
        break
      }

      case 'preserve_evidence': {
        const privacy = await getPrivacySettings(householdId)
        if (!privacy.aiVideoAnalysis) {
          await writeAudit(caseId, createAuditEvent('ai', 'tool_call', {
            tool: canonical,
            decision: 'refused',
            reason: 'ai_video_analysis_disabled',
          }))
          return { success: false, reason: 'AI video analysis is disabled by privacy settings' }
        }
        // Store evidence preservation marker
        const { applyRiskEdit } = await import('./caseRiskStore')
        await applyRiskEdit(caseId, {
          kind: 'statement',
          statementKind: 'expected', // Use statement kind to mark preservation
          who: 'ai',
          note: 'evidence_preserved',
        })
        result = { preserved: true }
        break
      }

      case 'escalate_to_backup':
      case 'enforce_entry_policy':
      case 'trigger_emergency_workflow': {
        // These are rule-only tools - AI cannot execute them directly
        await writeAudit(caseId, createAuditEvent('ai', 'tool_call', {
          tool: canonical,
          decision: 'refused',
          reason: 'rule_only',
        }))
        return { success: false, reason: `Tool is rule-only and cannot be called by AI: ${canonical}` }
      }

      case 'request_evidence_confirmation': {
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
        // Execute controller tool
        result = await executeControllerTool(caseId, householdId, canonical, args)
        break
      }
    }

    await writeAudit(caseId, createAuditEvent('ai', 'tool_call', {
      tool: canonical,
      decision: 'executed',
      result,
    }))

    return { success: true, data: result }
  } catch (error) {
    // Mark AI as unavailable on failure
    await markAiUnavailable(caseId, householdId, String(error))
    await writeAudit(caseId, createAuditEvent('ai', 'tool_call', {
      tool: canonical,
      decision: 'failed',
      error: String(error),
    }))
    return { success: false, reason: `Tool execution failed: ${error}` }
  }
}
