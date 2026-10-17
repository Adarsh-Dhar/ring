/** Deterministic risk flagger. Output is for the helper only. */
import { embed } from '@/lib/ai/client'
import type { RuleMatch } from '@/lib/ai/risk/combine'

const RULES: { flag: string; re: RegExp }[] = [
  { flag: 'Claims urgency',            re: /\b(urgent(ly)?|immediately|right now|emergency|last chance|final notice)\b/i },
  { flag: 'Mentions bank or payment',  re: /\b(bank|card|pin number|cash|payment|transfer|refund|invoice)\b/i },
  { flag: 'Claims to be officials',    re: /\b(council|police|inspector|inspection|government|tax office|hmrc|irs|social services)\b/i },
  { flag: 'Wants to enter or check inside', re: /\b(check (the )?(meter|boiler|pipes|roof|wiring)|come inside|let me in|look around|survey)\b/i },
  { flag: 'Asks who is home',          re: /\b(anyone (home|in)|who('s| is) (home|in)|alone|are you on your own)\b/i },
  { flag: 'Offers work or sells',      re: /\b(driveway|roof(ing)?|gutter|tarmac|tree work|spare (materials|tarmac)|special offer|free (check|quote|sample)|sell(ing|er|s)?|sales ?(man|woman|person|rep|pitch)|salesm[ae]n|door[- ]to[- ]door|discount|brochure|leaflet|subscription)\b/i },
]

export function riskFlagsFor(transcript: string): string[] {
  const flags = new Set<string>()
  for (const r of RULES) if (r.re.test(transcript)) flags.add(r.flag)
  return [...flags]
}

/** Same rules, but keeps the exact words that matched so the score can be checked against the transcript. */
export function riskMatchesFor(transcript: string): RuleMatch[] {
  const out: RuleMatch[] = []
  for (const r of RULES) { const m = transcript.match(r.re); if (m) out.push({ flag: r.flag, quote: m[0] }) }
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
