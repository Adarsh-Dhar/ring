/**
 * Risk assessment: how the AI judge and the regex rules become a score.
 * Pure functions. The only import is the pure rules engine, so this can be unit-tested without a model or a database.
 *
 * Principles (all enforced here, in code, not in the prompt):
 *  - The model EXTRACTS observations (a category plus a quote). It never supplies a level or a score.
 *    Code (lib/doorstep/riskRules.ts) decides what each observation is worth.
 *  - A model claim only counts if it quotes the visitor. Quotes are checked against the real transcript.
 *  - If the model is unavailable, the keyword rules still produce a score from their own matched words.
 *  - Vague, evasive and unverifiable answers are shown to helpers as notes. They never add points.
 *  - The level and labels are advisory and helper-only. Nothing here touches the alert path.
 */
import {
  legacyLevel, observationsFromEvidence, scoreObservations, NOTE_ONLY_CATEGORIES, type InterviewState,
  type Behaviour, type ControlMode, type LedgerEntry, type Observation,
} from '@/lib/doorstep/riskRules'

export const LEVELS = ['none', 'low', 'medium', 'high'] as const
export type RiskLevel = (typeof LEVELS)[number]

export const RISK_CATEGORIES = [
  'pressure_after_rule',
  'pressure_after_boundary',
  'purpose_contradiction',
  'hide_from_helper',
  'payment_request',
  'refuse_to_leave',
  'spoken_threat',
  'entry_request',
  'home_probing',
  'official_impersonation',
  'manipulation_attempt',
  'urgency_pressure',
  'unsolicited_work',
  'story_mismatch',
  'evasive_answers',
  'known_scam_wording',
  'vague_purpose',
  'unverifiable_claims',
  'other',
] as const
export type RiskCategory = (typeof RISK_CATEGORIES)[number]

/** Helper-facing labels. Deliberately avoid words the shared banned-phrase list blocks (digest reuses these). */
export const CATEGORY_LABEL: Record<RiskCategory, string> = {
  pressure_after_rule:     'Pressure after rules were explained',
  pressure_after_boundary: 'Pressure after a boundary was stated',
  purpose_contradiction:   'Contradicted their stated purpose',
  hide_from_helper:        'Tried to hide from the helper',
  payment_request:         'Asked for PIN, OTP, password or access code',
  refuse_to_leave:         'Refused to leave when asked',
  spoken_threat:           'Made a threat',
  entry_request:           'Wants to come inside',
  home_probing:            'Asked who else is at home',
  official_impersonation:  'Claims to be an official',
  manipulation_attempt:    'Tried to steer the assistant',
  urgency_pressure:        'Pressure to act quickly',
  unsolicited_work:        'Selling or offering work nobody asked for',
  story_mismatch:          'Answers do not add up',
  evasive_answers:         'Avoided answering',
  known_scam_wording:      'Wording matches known tricks',
  vague_purpose:           'Reason stayed vague',
  unverifiable_claims:     'Could not back up claims',
  other:                   'Other concern',
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
  'Refuses to leave':                 'refuse_to_leave',
  'Hides from helper':                'hide_from_helper',
}

/** Fixed helper-facing advice per level. Not model-written. */
export const ACTION_TEXT: Record<RiskLevel, string | null> = {
  none:   null,
  low:    'Probably fine, but check the person yourself.',
  medium: 'Verify who they are before the door is opened. Ask for ID, and phone the organisation on a number you look up yourself.',
  high:   'Suggested: do not open the door yet. Contact the resident or a guardian and check who this is first.',
}

export interface Evidence { category: RiskCategory; quote: string }
/** `level` is accepted for old model output but IGNORED. Only the evidence counts. */
export interface JudgeResult { level?: RiskLevel; evidence: Evidence[]; rationale: string }

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
  /** Deterministic score 0 to 100 from lib/doorstep/riskRules.ts. */
  score: number
  /** One entry per observation: what it was, whether it counted, and the points it added. */
  ledger: LedgerEntry[]
  /** Minimum control mode set by serious events. The score alone can never lower it. */
  minMode: ControlMode
  /** Categories shown to the helper as information only. They add no points. */
  notes: string[]
}

export const rank = (l: RiskLevel) => LEVELS.indexOf(l)
export const maxLevel = (...ls: RiskLevel[]): RiskLevel => ls.reduce((a, b) => (rank(b) > rank(a) ? b : a), 'none' as RiskLevel)
export const capLevel = (l: RiskLevel, cap: RiskLevel): RiskLevel => (rank(l) > rank(cap) ? cap : l)

export const categoriesFromRuleFlags = (flags: string[]): RiskCategory[] => {
  const out = new Set<RiskCategory>()
  for (const f of flags) { const c = RULE_FLAG_CATEGORY[f]; if (c) out.add(c) }
  return [...out]
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

/** A keyword the regex rules matched, with the exact words that matched (so the score can be grounded in the transcript). */
export interface RuleMatch { flag: string; quote: string }

/** Keyword flags that become scored behaviours. Money, selling and scam-wording flags are hints only and never score by themselves. */
const RULE_FLAG_BEHAVIOUR: Record<string, Behaviour> = {
  'Claims urgency':                 'pressure_after_boundary',
  'Refuses to leave':               'refuse_to_leave',
  'Hides from helper':              'hide_from_helper',
}

export function observationsFromRuleMatches(matches: RuleMatch[]): Observation[] {
  const out: Observation[] = []
  for (const m of matches) {
    const b = RULE_FLAG_BEHAVIOUR[m.flag]
    if (b) {
      out.push({
        code: b,
        at: new Date().toISOString(),
        quotes: [m.quote],
        source: 'transcript',
        state: 'uncertain',
        points: 0,
        transcriptQuality: undefined, // Would need engine confidence from STT
      })
    }
  }
  return out
}

function assemble(a: {
  transcript: string; cats: Set<RiskCategory>; evidence: Evidence[]; rationale: string
  source: Assessment['source']; ruleMatches: RuleMatch[]; interviewState?: InterviewState
}): Assessment {
  const fromJudge = observationsFromEvidence(a.evidence)
  const judged = new Set(fromJudge.observations.map(o => o.code))
  // A keyword hit and a judge hit on the same behaviour are one observation, not two.
  const fromRules = observationsFromRuleMatches(a.ruleMatches).filter(o => !judged.has(o.code))
  const risk = scoreObservations([...fromRules, ...fromJudge.observations], { transcript: a.transcript, interviewState: a.interviewState })
  const level = legacyLevel(risk.score, risk.minMode)
  const all = [...a.cats]
  return {
    level, categories: all, labels: all.map(c => CATEGORY_LABEL[c]), evidence: a.evidence, rationale: a.rationale,
    action: ACTION_TEXT[level], source: a.source, assessedAt: new Date().toISOString(),
    score: risk.score, ledger: risk.ledger, minMode: risk.minMode,
    notes: all.filter(c => (NOTE_ONLY_CATEGORIES as readonly string[]).includes(c)),
  }
}

/**
 * Score shown while the conversation is still going. Built only from the keyword matches, so it can never be
 * inflated by an ungrounded model hint. Coverage facts are shown as notes and add no points.
 */
export function liveAssessment(
  transcript: string, ruleMatches: RuleMatch[],
  extra?: { coverage?: { purposeVague: boolean; unverifiable: boolean }; inconsistent?: boolean; evasive?: boolean; interviewState?: InterviewState },
): Assessment {
  const cats = new Set<RiskCategory>(categoriesFromRuleFlags(ruleMatches.map(m => m.flag)))
  if (extra?.inconsistent) cats.add('story_mismatch')
  if (extra?.evasive) cats.add('evasive_answers')
  if (extra?.coverage?.purposeVague) cats.add('vague_purpose')
  if (extra?.coverage?.unverifiable) cats.add('unverifiable_claims')
  return assemble({ transcript, cats, evidence: [], rationale: '', source: 'live', ruleMatches, interviewState: extra?.interviewState })
}

export function buildAssessment(a: {
  transcript: string
  ruleFlags: string[]
  /** The words each keyword rule matched. Without these the keyword rules add no points. */
  ruleMatches?: RuleMatch[]
  judge: JudgeResult | null
  inconsistent?: boolean
  evasive?: boolean
  /** Computed by the interview plan from what the visitor did or did not give. Shown as notes only. */
  coverage?: { purposeVague: boolean; unverifiable: boolean }
  interviewState?: InterviewState
}): Assessment {
  const cats = new Set<RiskCategory>(categoriesFromRuleFlags(a.ruleFlags))
  if (a.inconsistent) cats.add('story_mismatch')
  if (a.evasive) cats.add('evasive_answers')
  if (a.coverage?.purposeVague) cats.add('vague_purpose')
  if (a.coverage?.unverifiable) cats.add('unverifiable_claims')

  let evidence: Evidence[] = []
  let rationale = ''
  let usedJudge = false

  if (a.judge) {
    evidence = groundEvidence(a.judge.evidence, a.transcript)
    for (const e of evidence) cats.add(e.category)
    rationale = clampWordsLocal(a.judge.rationale || '', 40)
    usedJudge = true
  }

  return assemble({
    transcript: a.transcript, cats, evidence, rationale,
    source: usedJudge ? 'ai+rules' : 'rules', ruleMatches: a.ruleMatches ?? [], interviewState: a.interviewState,
  })
}
