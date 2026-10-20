/**
 * Independent verification module (WP5).
 * Provides helpers to verify visitor claims against external sources.
 * This is a safety layer that allows the AI to request verification without
 * revealing resident information or taking risky actions.
 */

export interface Claim {
  type: 'organisation' | 'identity' | 'phone' | 'reference'
  value: string
  source: 'visitor' | 'document' | 'camera'
}

export interface VerificationRequest {
  caseId: string
  claim: Claim
  timestamp: number
}

export interface VerificationResult {
  verified: boolean
  confidence: 'high' | 'medium' | 'low'
  details?: string
  requiresHumanReview: boolean
}

/**
 * Queue a verification request for later processing by a helper.
 * The AI cannot perform external verification itself; it can only
 * mark that verification is needed.
 */
export function queueVerification(caseId: string, claim: Claim): VerificationRequest {
  return {
    caseId,
    claim,
    timestamp: Date.now(),
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
