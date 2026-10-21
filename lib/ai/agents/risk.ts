/** Deterministic risk flagger. Output is for the helper only. */
import { embed } from '@/lib/ai/client'
import type { RuleMatch } from '@/lib/ai/risk/combine'

const RULES: { flag: string; re: RegExp }[] = [
  { flag: 'Claims urgency',            re: /\b(urgent(ly)?|immediately|right now|emergency|last chance|final notice)\b/i },
  { flag: 'Mentions bank or payment',  re: /\b(bank|card|pin number|cash|payment|transfer|refund|invoice)\b/i },
  { flag: 'Claims to be officials',    re: /\b(council|police|inspector|inspection|government|tax office|hmrc|irs|social services)\b/i },
  { flag: 'Wants to enter or check inside', re: /\b(check (the )?(meter|boiler|pipes|roof|wiring)|come inside|let me in|lemme in|look around|survey)\b/i },
  { flag: 'Asks who is home',          re: /\b(anyone (home|in)|who('s| is) (home|in)|alone|are you on your own)\b/i },
  { flag: 'Offers work or sells',      re: /\b(driveway|roof(ing)?|gutter|tarmac|tree work|spare (materials|tarmac)|special offer|free (check|quote|sample)|sell(ing|er|s)?|sales ?(man|woman|person|rep|pitch)|salesm[ae]n|door[- ]to[- ]door|discount|brochure|leaflet|subscription)\b/i },
  { flag: 'Refuses to leave',          re: /\b(not leaving|i('m| am) staying|i won'?t leave|let me talk to them|get (the )?(owner|resident)|i know (them|him|her))\b/i },
  { flag: 'Hides from helper',         re: /\b(tell (them|him|her) (i am )?(not )?(here|gone|busy|sleeping)|(don'?t|do not) (call|tell|answer)|(just|only) me|(go away|leave) (me|us) alone)\b/i },
  { flag: 'Credential request',        re: /\b(pin|otp|password|access code|verification code|security code|account number)\b/i },
  { flag: 'Immediate threat',          re: /\b(i('ll| will)|i'?m going to|i'?m gonna)\s+(hurt|kill|stab|shoot|beat\s+(you|ya)(\s+up)?|beat\s+up|burn\s+you)\b|\byou('re| are) dead\b|\bshut (your )?mouth\b|\bor (i|you)('ll| will) (make you|pay for this)\b|\bwatch (your )?back\b/i },
]

export function riskFlagsFor(transcript: string): string[] {
  const flags = new Set<string>()
  for (const r of RULES) if (r.re.test(transcript)) flags.add(r.flag)
  return [...flags]
}

/** Same rules, but keeps the exact words that matched so the score can be checked against the transcript. Captures all occurrences, not just the first. */
export function riskMatchesFor(transcript: string): RuleMatch[] {
  const out: RuleMatch[] = []
  for (const r of RULES) {
    const re = new RegExp(r.re.source, r.re.flags.includes('g') ? r.re.flags : r.re.flags + 'g')
    for (const m of transcript.matchAll(re)) out.push({ flag: r.flag, quote: m[0] })
  }
  return out
}

const SCAM_REFERENCE = [
  'I am from the council and need to inspect your property',
  'your bank sent me to collect your card',
  'we have leftover tarmac and can do your driveway cheap today',
  'I need to check your gas meter inside the house',
  'police asked me to check on you, let me in',
  'is anyone else home with you',
]

const cos = (a: number[], b: number[]) => {
  let d = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return d / (Math.sqrt(na * nb) || 1)
}

/** Optional semantic pass, one embedding request. Only runs when regex found nothing and AI_EMBED_RISK=1. */
export async function semanticFlag(householdId: string, transcript: string): Promise<string | null> {
  if (process.env.AI_EMBED_RISK !== '1' || transcript.trim().length < 8) return null
  const vecs = await embed(householdId, [transcript, ...SCAM_REFERENCE])
  if (!vecs) return null
  const [t, ...refs] = vecs
  const best = Math.max(...refs.map(r => cos(t, r)))
  return best >= Number(process.env.AI_EMBED_RISK_THRESHOLD || 0.82) ? 'Similar to known scam wording' : null
}
