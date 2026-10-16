/**
 * Risk assessment: how the AI judge, the regex rules and the live hint are combined.
 * Pure functions, no imports, so they can be unit-tested without a model or a database.
 *
 * Principles (all enforced here, in code, not in the prompt):
 *  - The model may RAISE the level. It can never lower it below what the rules found.
 *  - A model claim only counts if it quotes the visitor. Quotes are checked against the real transcript.
 *  - If the model is unavailable, the rules still produce a level (the old behaviour).
 *  - The level and labels are advisory and helper-only. Nothing here touches the alert path.
 */

export const LEVELS = ['none', 'low', 'medium', 'high'] as const
export type RiskLevel = (typeof LEVELS)[number]

export const RISK_CATEGORIES = [
  'urgency_pressure', 'payment_request', 'official_impersonation', 'entry_request',
  'home_probing', 'unsolicited_work', 'story_mismatch', 'evasive_answers',
  'manipulation_attempt', 'known_scam_wording', 'other',
] as const
export type RiskCategory = (typeof RISK_CATEGORIES)[number]

/** Helper-facing labels. Deliberately avoid words the shared banned-phrase list blocks (digest reuses these). */
export const CATEGORY_LABEL: Record<RiskCategory, string> = {
  urgency_pressure:       'Pressure to act quickly',
  payment_request:        'Money or card details mentioned',
  official_impersonation: 'Claims to be an official',
  entry_request:          'Wants to come inside',
  home_probing:           'Asked who else is at home',
  unsolicited_work:       'Unrequested work offer',
  story_mismatch:         'Answers do not add up',
  evasive_answers:        'Avoided answering',
  manipulation_attempt:   'Tried to steer the assistant',
  known_scam_wording:     'Wording matches known tricks',
  other:                  'Other concern',
}

/** Maps the flag strings produced by the regex rules in agents/risk.ts to categories. */
export const RULE_FLAG_CATEGORY: Record<string, RiskCategory> = {
  'Claims urgency':                   'urgency_pressure',
  'Mentions bank or payment':         'payment_request',
  'Claims to be officials':           'official_impersonation',
  'Wants to enter or check inside':   'entry_request',
  'Asks who is home':                 'home_probing',
  'Offers work or sells':             'unsolicited_work',
  'Similar to known scam wording':    'known_scam_wording',
}

/** Fixed helper-facing advice per level. Not model-written. */
export const ACTION_TEXT: Record<RiskLevel, string | null> = {
  none:   null,
  low:    'Probably fine, but check the person yourself.',
  medium: 'Verify who they are before the door is opened. Ask for ID, and phone the organisation on a number you look up yourself.',
  high:   'Suggested: do not open the door yet. Contact the resident or a guardian and check who this is first.',
}

export interface Evidence { category: RiskCategory; quote: string }
export interface JudgeResult { level: RiskLevel; evidence: Evidence[]; rationale: string }

export interface Assessment {
  level: RiskLevel
  categories: RiskCategory[]
  labels: string[]
  evidence: Evidence[]
  rationale: string
  action: string | null
  /** 'ai+rules' = judge answered; 'rules' = judge unavailable or ungrounded; 'live' = in-progress, not final */
  source: 'ai+rules' | 'rules' | 'live'
  assessedAt: string
}

export const rank = (l: RiskLevel) => LEVELS.indexOf(l)
export const maxLevel = (...ls: RiskLevel[]): RiskLevel => ls.reduce((a, b) => (rank(b) > rank(a) ? b : a), 'none' as RiskLevel)
export const capLevel = (l: RiskLevel, cap: RiskLevel): RiskLevel => (rank(l) > rank(cap) ? cap : l)

export const categoriesFromRuleFlags = (flags: string[]): RiskCategory[] => {
  const out = new Set<RiskCategory>()
  for (const f of flags) { const c = RULE_FLAG_CATEGORY[f]; if (c) out.add(c) }
  return [...out]
}

/**
 * Minimum level implied by the categories alone (deterministic floor).
 *  - classic distraction pattern: wants to come in AND at least two other signals  -> high
 *  - official + payment                                                           -> high
 *  - two or more distinct signals, or any attempt to steer the assistant         -> medium
 *  - one signal                                                                   -> low
 */
export function floorFor(cats: RiskCategory[]): RiskLevel {
  const s = new Set(cats.filter(c => c !== 'other'))
  const n = s.size
  if (n === 0) return 'none'
  if (s.has('entry_request') && n >= 3) return 'high'
  if (s.has('official_impersonation') && s.has('payment_request')) return 'high'
  if (s.has('manipulation_attempt') || n >= 2) return 'medium'   // trying to steer the assistant is a strong signal on its own
  return 'low'
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9£$€%\s]/g, ' ').replace(/\s+/g, ' ').trim()

/** Keep only evidence whose quote really appears in the transcript. Defeats invented quotes. */
export function groundEvidence(evidence: Evidence[], transcript: string): Evidence[] {
  const hay = norm(transcript)
  const seen = new Set<string>()
  const out: Evidence[] = []
  for (const e of evidence) {
    const q = norm(e.quote)
    if (q.length < 3 || !(RISK_CATEGORIES as readonly string[]).includes(e.category)) continue
    if (!hay.includes(q)) continue
    const key = `${e.category}|${q}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ category: e.category, quote: e.quote.trim().split(/\s+/).slice(0, 12).join(' ') })
  }
  return out.slice(0, 6)
}

const clampWordsLocal = (s: string, max: number) => { const w = s.trim().split(/\s+/); return w.length <= max ? s.trim() : w.slice(0, max).join(' ') + '…' }

/** Level shown while the conversation is still going. The live AI hint is ungrounded, so it can reach 'medium' at most. */
export function liveAssessment(ruleFlags: string[], hint: RiskLevel): Assessment {
  const cats = categoriesFromRuleFlags(ruleFlags)
  const level = maxLevel(floorFor(cats), capLevel(hint, 'medium'))
  return {
    level, categories: cats, labels: cats.map(c => CATEGORY_LABEL[c]), evidence: [], rationale: '',
    action: ACTION_TEXT[level], source: 'live', assessedAt: new Date().toISOString(),
  }
}

export function buildAssessment(a: {
  transcript: string
  ruleFlags: string[]
  judge: JudgeResult | null
  liveHint?: RiskLevel
  inconsistent?: boolean
  evasive?: boolean
}): Assessment {
  const cats = new Set<RiskCategory>(categoriesFromRuleFlags(a.ruleFlags))
  if (a.inconsistent) cats.add('story_mismatch')
  if (a.evasive) cats.add('evasive_answers')

  let evidence: Evidence[] = []
  let judgeLevel: RiskLevel = 'none'
  let rationale = ''
  let usedJudge = false

  if (a.judge) {
    evidence = groundEvidence(a.judge.evidence, a.transcript)
    for (const e of evidence) cats.add(e.category)
    judgeLevel = a.judge.level
    // A medium/high verdict with no verifiable quote is not trusted beyond 'low'.
    if (rank(judgeLevel) >= rank('medium') && evidence.length === 0) judgeLevel = 'low'
    rationale = clampWordsLocal(a.judge.rationale || '', 40)
    usedJudge = true
  } else {
    // No judge: the live hint (ungrounded) can still lift a clean transcript to 'medium', never higher.
    judgeLevel = capLevel(a.liveHint ?? 'none', 'medium')
  }

  const all = [...cats]
  const level = maxLevel(judgeLevel, floorFor(all))
  return {
    level,
    categories: all,
    labels: all.map(c => CATEGORY_LABEL[c]),
    evidence,
    rationale,
    action: ACTION_TEXT[level],
    source: usedJudge ? 'ai+rules' : 'rules',
    assessedAt: new Date().toISOString(),
  }
}
