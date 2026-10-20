/**
 * AI unavailable marking (spec 9.5).
 *
 * Marks the case when AI analysis is unavailable, adds 0 points, and tells the helper once.
 * Wired into the interrogator failure paths. Helper card shows it.
 */

import { getDb } from '@/lib/db/client'
import { writeAudit, createAuditEvent } from './audit'
import { applyRiskEdit } from './caseRiskStore'

/**
 * Mark a case as having AI analysis unavailable.
 *
 * This adds a marker to the risk observations, adds 0 points (by design),
 * and creates an audit entry. The helper card will show this status.
 */
export async function markAiUnavailable(
  caseId: string,
  householdId: string,
  reason: string
): Promise<void> {
  try {
    // Add a statement marker for AI unavailability
    await applyRiskEdit(caseId, {
      kind: 'statement',
      statementKind: 'expected', // Use statement kind to mark
      who: 'system',
      note: `AI unavailable: ${reason}`,
    })

    // Log the event
    await writeAudit(caseId, createAuditEvent('system', 'ai_unavailable', {
      reason,
      timestamp: new Date().toISOString(),
    }))

    // Notify helpers once
    const { createHelperRequest } = await import('./helperRequests')
    const memberships = await getDb().membership.findMany({
      where: { householdId, consent: 'approved' },
    })

    // Only notify if not already notified (deduplication via helper request)
    for (const m of memberships) {
      const existing = await createHelperRequest({
        caseId,
        membershipId: m.id,
        kind: 'risk_decision', // Use risk_decision as the notification kind
      })
      if (existing) {
        // Request created - notification will be sent
        break // Only notify one helper to avoid spam
      }
    }
  } catch (error) {
    console.error('[analysisAvailability] Failed to mark AI unavailable:', error)
  }
}

/**
 * Check if AI analysis is currently unavailable for a case.
 */
export async function isAiUnavailable(caseId: string): Promise<boolean> {
  try {
    const c = await getDb().case.findUnique({
      where: { id: caseId },
      select: { riskObservations: true },
    })

    if (!c) return false

    const { readStored } = await import('./caseRisk')
    const stored = readStored(c.riskObservations as unknown)

    // Check if AI is marked as unavailable via statement
    return stored.statements?.some(s => s.note?.startsWith('AI unavailable:')) ?? false
  } catch (error) {
    console.error('[analysisAvailability] Failed to check AI availability:', error)
    return false
  }
}
