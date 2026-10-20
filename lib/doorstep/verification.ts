/**
 * Independent verification module (WP6).
 * Provides real verification against household-controlled records.
 * This is a safety layer that allows the AI to verify claims without
 * revealing resident information or taking risky actions.
 */

import { getDb } from '@/lib/db/client'

export interface Claim {
  type: 'organisation' | 'identity' | 'phone' | 'reference' | 'purpose' | 'relation'
  value: string
  source: 'visitor' | 'document' | 'camera'
}

export interface VerificationResult {
  status: 'verified' | 'not_found' | 'unavailable'
  source?: string
  checkedAt: number
  explanation: string
}

/**
 * Verify a claim against household-controlled records.
 * Only sources that exist in the repository and are authorized are used.
 */
export async function verifyClaim(
  householdId: string,
  caseId: string,
  claim: Claim
): Promise<VerificationResult> {
  const db = getDb()
  const now = Date.now()

  // Check against recurring visitors
  if (claim.type === 'organisation' || claim.type === 'identity') {
    const recurring = await db.recurringVisit.findFirst({
      where: { householdId },
    })
    if (recurring && recurring.who) {
      const normalizedClaim = claim.value.toLowerCase().trim()
      const normalizedWho = recurring.who.toLowerCase().trim()
      if (normalizedClaim.includes(normalizedWho) || normalizedWho.includes(normalizedClaim)) {
        return {
          status: 'verified',
          source: 'recurring_visitor',
          checkedAt: now,
          explanation: `Matches recurring visitor record: ${recurring.who}`,
        }
      }
    }
  }

  // Check against expected visits
  if (claim.type === 'organisation' || claim.type === 'purpose') {
    const expected = await db.expectedVisit.findFirst({
      where: {
        householdId,
        startsAt: { lte: new Date(now) },
        endsAt: { gte: new Date(now) },
      },
    })
    if (expected && expected.who) {
      const normalizedClaim = claim.value.toLowerCase().trim()
      const normalizedWho = expected.who.toLowerCase().trim()
      if (normalizedClaim.includes(normalizedWho) || normalizedWho.includes(normalizedClaim)) {
        return {
          status: 'verified',
          source: 'expected_visit',
          checkedAt: now,
          explanation: `Matches expected visit: ${expected.who}`,
        }
      }
    }
  }

  // Check against regular visitors
  if (claim.type === 'identity') {
    const regular = await db.regularVisitor.findFirst({
      where: { householdId },
    })
    if (regular && regular.name) {
      const normalizedClaim = claim.value.toLowerCase().trim()
      const normalizedName = regular.name.toLowerCase().trim()
      if (normalizedClaim.includes(normalizedName) || normalizedName.includes(normalizedClaim)) {
        return {
          status: 'verified',
          source: 'regular_visitor',
          checkedAt: now,
          explanation: `Matches regular visitor: ${regular.name}`,
        }
      }
    }
  }

  // Claim not found in any authorized source
  return {
    status: 'not_found',
    checkedAt: now,
    explanation: 'No match found in household records (recurring visitors, expected visits, or regular visitors)',
  }
}

/**
 * Determine if a claim requires immediate human verification.
 * Some claims (e.g., official documents, emergency services) are
 * higher priority than others.
 */
export function requiresHumanReview(claim: Claim): boolean {
  // Any claim to be an official or emergency service requires human review
  if (claim.type === 'organisation') {
    const org = claim.value.toLowerCase()
    const officialKeywords = ['police', 'fire', 'ambulance', 'emergency', 'government', 'council', 'authority']
    return officialKeywords.some(k => org.includes(k))
  }
  // Identity claims from documents require human review
  if (claim.type === 'identity' && claim.source === 'document') {
    return true
  }
  return false
}

/**
 * Assess verification confidence based on the claim type and source.
 * This is used by the risk judge to weigh the evidence.
 */
export function verificationConfidence(claim: Claim): 'high' | 'medium' | 'low' {
  if (claim.source === 'document') return 'high'
  if (claim.source === 'camera') return 'medium'
  if (claim.source === 'visitor') return 'low'
  return 'low'
}
