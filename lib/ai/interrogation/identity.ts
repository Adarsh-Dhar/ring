/**
 * "Who does the visitor say they are?"  Two small, pure pieces:
 *
 *  1. identityObjectiveDue(): when a visitor says they are a friend / relative / neighbour / acquaintance of the resident
 *     but has not yet told the door who THEY are, the next question is about that. The decision is made in code (the model
 *     only words the question), it is asked once, and it is never pressed after a decline.
 *  2. claimedIdentityOf(): folds what the visitor said into one short, helper-facing summary that is shown next to the
 *     risk score. It is a CLAIM. Nothing here verifies it, and it never changes the risk score.
 *
 * No imports from the app, so it can be unit-tested without a model or a database.
 */
import type { StoredAnalysis, CaseFile } from './casefile'
import type { Slot } from './plan'

/** How many identity questions may be asked beyond the operator's follow-up ceiling (name, then how they know the resident). */
export const IDENTITY_EXTRA_QUESTIONS = 2

/** What the interviewer must find out first, or null. */
export function identityObjectiveDue(f: Pick<CaseFile, 'flags' | 'latest' | 'asks' | 'consecutiveDeclines'>): Slot | null {
  if (!f.flags.personalTie) return null
  if (f.consecutiveDeclines > 0) return null          // a decline gets autonomy support, never another push
  const settled = (k: Slot) => f.latest[k]?.specificity === 'specific' || f.latest[k]?.specificity === 'refused' || f.asks[k] >= 1
  if (!settled('name')) return 'name'
  if (!settled('relation')) return 'relation'
  return null
}

export const IDENTITY_RATIONALE: Partial<Record<Slot, string>> = {
  name: 'Visitor says they know the resident but has not said who they are. Ask for their own name.',
  relation: 'Visitor says they know the resident but has not said how. Ask how they know them.',
}

/** Extra guidance for the speaker when the objective is an identity question. */
export const OBJECTIVE_HINT: Partial<Record<Slot, string>> = {
  name: "Ask ONLY for the visitor's own name, for example \"May I have your name, please?\". Do not repeat or confirm anyone they named, and do not say who lives here.",
  relation: 'Ask ONLY how they know the person they came to see, in their own words, for example "How do you know them?". Do not name anyone and do not confirm anyone lives here.',
}

// ── helper-facing summary ─────────────────────────────────────────────────────

export type NameStatus = 'given' | 'declined' | 'not_given'

export interface ClaimedIdentity {
  /** What they call themselves. */
  name: string | null
  nameStatus: NameStatus
  /** How they say they know the resident ("friend", "nephew", "neighbour"). */
  relation: string | null
  /** Who they say they know or came to see. */
  forWhom: string | null
  organisation: string | null
  /** One plain line for the card. */
  summary: string
  /** Always false: nothing in the interview checks any of this. */
  verified: false
}

const clean = (s: unknown): string | null => {
  if (typeof s !== 'string') return null
  const t = s.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  return t.length ? t : null
}
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
/** A name or person the model reports must actually appear in what the visitor said (typed or heard). */
const spoken = (value: string | null, transcripts: string): string | null => {
  if (!value) return null
  const v = norm(value)
  return v.length >= 2 && norm(transcripts).includes(v) ? value : null
}

export function claimedIdentityOf(analyses: StoredAnalysis[], transcripts: string): ClaimedIdentity | null {
  let name: string | null = null
  let nameStatus: NameStatus = 'not_given'
  let relation: string | null = null
  let forWhom: string | null = null
  let organisation: string | null = null
  let tie = false

  for (const a of analyses) {
    tie ||= !!a.claimsPersonalTie
    const named = spoken(clean(a.claims?.name), transcripts)
      ?? spoken(clean(a.commitments.find(c => c.topic === 'name' && c.specificity === 'specific')?.value), transcripts)
    if (named) { name = named; nameStatus = 'given' }
    else if (a.commitments.some(c => c.topic === 'name' && c.specificity === 'refused') && !name) nameStatus = 'declined'

    relation = clean(a.claims?.relation) ?? clean(a.commitments.find(c => c.topic === 'relation' && c.specificity !== 'refused')?.value) ?? relation
    forWhom = spoken(clean(a.claims?.forWhom), transcripts)
      ?? spoken(clean(a.commitments.find(c => c.topic === 'target' && c.specificity !== 'refused')?.value), transcripts) ?? forWhom
    organisation = clean(a.claims?.organisation) ?? organisation
  }

  if (!tie && !name && !relation && !forWhom && !organisation && nameStatus === 'not_given') return null

  const who = name ?? (nameStatus === 'declined' ? 'Declined to give a name' : 'Name not given yet')
  const knows = forWhom ? `Says they know ${forWhom}${relation ? ` (${relation})` : ''}` : relation ? `Says they are: ${relation}` : organisation ? `Says they are from ${organisation}` : ''
  const summary = [who, knows, 'Not verified'].filter(Boolean).join('. ') + '.'
  return { name, nameStatus, relation, forWhom, organisation, summary, verified: false }
}

/** The "claims" block stored on the case: latest non-empty value per field, plus the identity summary. */
export function claimsBlock(analyses: StoredAnalysis[], transcripts: string) {
  const claims = { name: null, organisation: null, reason: null, forWhom: null, time: null } as Record<'name' | 'organisation' | 'reason' | 'forWhom' | 'time', string | null>
  for (const a of analyses) for (const k of Object.keys(claims) as (keyof typeof claims)[]) if (a.claims?.[k]) claims[k] = a.claims[k]
  return { ...claims, identity: claimedIdentityOf(analyses, transcripts) }
}
