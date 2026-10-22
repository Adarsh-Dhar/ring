// Patch to add transcriptQuality parameter to assemble function
// This should be applied to lib/ai/risk/combine.ts

// Change line 213 from:
function assemble(a: {
  transcript: string; cats: Set<RiskCategory>; evidence: Evidence[]; rationale: string
  source: Assessment['source']; ruleMatches: RuleMatch[]; interviewState?: InterviewState; precomputedObservations?: Observation[]
}): Assessment {

// To:
function assemble(a: {
  transcript: string; cats: Set<RiskCategory>; evidence: Evidence[]; rationale: string
  source: Assessment['source']; ruleMatches: RuleMatch[]; interviewState?: InterviewState; precomputedObservations?: Observation[]
  transcriptQuality?: 'high' | 'medium' | 'low'
}): Assessment {

// Change line 222 from:
  const fromRules = a.precomputedObservations || observationsFromRuleMatches(a.ruleMatches).filter(o => !judged.has(o.code))

// To:
  const fromRules = a.precomputedObservations || observationsFromRuleMatches(a.ruleMatches, a.transcriptQuality).filter(o => !judged.has(o.code))
