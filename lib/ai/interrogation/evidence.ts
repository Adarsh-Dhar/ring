/**
 * Case evidence and the Evidence Framing Matrix (EFM, Granhag et al. 2013) for the door interview.
 *
 * WHAT COUNTS AS EVIDENCE AT A DOOR
 *  - household-side: planned visits, the guardians' calendars. Never disclosed, never confirmed or denied to the
 *    visitor, never sent to the model. Used silently by code to check what the visitor says.
 *  - visitor-side: what the doorbell camera itself saw of THIS visitor (how many people, whether they approached
 *    the door, a description). The visitor can see the camera is there, so stating one of these facts reveals
 *    nothing about the household. These are the only facts the interviewer may ever put to a visitor.
 *
 * EFM: every item is classed by source strength (weak / strong) and specificity (low / high). When a visitor-side
 * fact is put to the visitor it is done incrementally, low specificity first, and only after the visitor has
 * committed to an account (SUE). We never imply we hold evidence we do not hold.
 */
import type { Commitment, Inconsistency } from './schemas'

export type Strength = 'weak' | 'strong'
export type EfmSpecificity = 'low' | 'high'
export type Quadrant = 'LS/WS' | 'HS/WS' | 'LS/SS' | 'HS/SS'

export const efmQuadrant = (strength: Strength, specificity: EfmSpecificity): Quadrant =>
  `${specificity === 'low' ? 'LS' : 'HS'}/${strength === 'weak' ? 'WS' : 'SS'}` as Quadrant

export interface EvidenceItem {
  id: string
  kind: 'known_visit' | 'calendar' | 'camera_people' | 'camera_description' | 'camera_approach'
  origin: 'household' | 'visitor_side'
  strength: Strength
  specificity: EfmSpecificity
  quadrant: Quadrant
  /** Plain statement of the fact. For visitor-side items this is the ONLY thing the interviewer may state. */
  fact: string
  /** Searchable text for household items. Never leaves the server. */
  text: string
  /** camera_people: how many people the camera saw, the visitor included. */
  count?: number
}

export interface EvidenceBundle {
  items: EvidenceItem[]
  /** True if at least one household source (a connected calendar or a known visit) could be consulted. */
  householdChecked: boolean
}

const item = (i: Omit<EvidenceItem, 'quadrant'>): EvidenceItem => ({ ...i, quadrant: efmQuadrant(i.strength, i.specificity) })

const WINDOW_MS = 3 * 3_600_000

/** Gather everything the interview may be checked against. Never throws: no evidence just means no checks. */
export async function ingestEvidence(
  householdId: string,
  c: { id?: string; clipDescription?: string | null; clipPeopleCount?: number | null; clipApproachedDoor?: boolean | null },
  now = new Date(),
): Promise<EvidenceBundle> {
  const items: EvidenceItem[] = []
  let householdChecked = false

  try {
    const { getKnownVisits, getCalendarEvents } = await import('@/lib/ai/agents/intake')
    const from = new Date(now.getTime() - WINDOW_MS), to = new Date(now.getTime() + WINDOW_MS)
    const known = await getKnownVisits(householdId, from, to)
    if (known.length) householdChecked = true
    known.forEach((k, n) => items.push(item({
      id: `visit:${n}`, kind: 'known_visit', origin: 'household', strength: 'strong',
      specificity: k.end - k.start <= 2 * 3_600_000 ? 'high' : 'low', fact: 'A planned visit is on record near this time', text: k.text,
    })))
    const cal = await getCalendarEvents(householdId, from, to)
    if (cal.anyConnected) householdChecked = true
    cal.events.forEach((e, n) => items.push(item({
      id: `cal:${n}`, kind: 'calendar', origin: 'household', strength: 'weak',
      specificity: e.end - e.start <= 2 * 3_600_000 ? 'high' : 'low', fact: 'A calendar entry is near this time', text: e.text,
    })))
  } catch (e) { console.error('[interrogation] household evidence unavailable', e) }

  // Camera facts about THIS visitor. Strong source (the doorbell itself), and the visitor can see the camera.
  if (typeof c.clipPeopleCount === 'number' && c.clipPeopleCount > 0) {
    const n = c.clipPeopleCount
    items.push(item({
      id: 'cam:people', kind: 'camera_people', origin: 'visitor_side', strength: 'strong', specificity: 'low',
      fact: `The doorbell camera sees ${n} ${n === 1 ? 'person' : 'people'} at the door`, text: '', count: n,
    }))
  }
  if (c.clipApproachedDoor) {
    items.push(item({
      id: 'cam:approach', kind: 'camera_approach', origin: 'visitor_side', strength: 'strong', specificity: 'low',
      fact: 'The doorbell camera saw someone walk up to the door', text: '',
    }))
  }
  if (c.clipDescription && c.clipDescription.trim().length > 3) {
    items.push(item({
      id: 'cam:description', kind: 'camera_description', origin: 'visitor_side', strength: 'strong', specificity: 'high',
      fact: `The doorbell camera shows: ${c.clipDescription.trim().slice(0, 140)}`, text: '',
    }))
  }
  return { items, householdChecked }
}

/** The one visitor-side fact the interviewer may state next: low specificity first, then high, one at a time. */
export function nextDisclosableFact(items: EvidenceItem[], alreadyDisclosed: string[]): EvidenceItem | null {
  const rank = (e: EvidenceItem) => (e.specificity === 'low' ? 0 : 1)
  return items.filter(e => e.origin === 'visitor_side' && !alreadyDisclosed.includes(e.id)).sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))[0] ?? null
}

// ── silent statement-evidence checks (code, no model, nothing said to the visitor) ──────────────────────────────

const STOP = new Set(['the', 'and', 'from', 'for', 'with', 'that', 'this', 'was', 'are', 'have', 'has', 'about', 'ltd', 'limited', 'services', 'service', 'visit', 'appointment'])
export const tokens = (s: string): string[] => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2 && !STOP.has(w))
const overlaps = (claim: string, text: string) => { const t = new Set(tokens(text)); return tokens(claim).some(w => t.has(w)) }

/**
 * Compare this answer's commitments with the evidence. Returns helper-facing statement-evidence inconsistencies.
 * These are verification results, not accusations: a camera clip can include a passer-by and a carer may have
 * arranged a visit nobody wrote down. The wording says what does and does not line up, nothing more.
 */
export function alignWithEvidence(now: Commitment[], all: Commitment[], ev: EvidenceBundle, turn: number): Inconsistency[] {
  const out: Inconsistency[] = []
  const people = ev.items.find(e => e.kind === 'camera_people')
  for (const c of now) {
    if (c.topic === 'companions' && c.count !== null && people?.count !== undefined && c.specificity !== 'refused') {
      const others = Math.max(people.count - 1, 0)
      if (c.count < others) out.push({
        kind: 'statement_evidence', topic: 'companions', peripheral: false, turn,
        summary: `Said ${c.count} other${c.count === 1 ? '' : 's'} with them; the camera shows ${people.count} people in total`,
        earlierQuote: people.fact, nowQuote: c.quote,
      })
    }
    if (c.topic === 'appointment' && c.specificity !== 'refused' && ev.householdChecked) {
      const claim = [c.value, ...all.filter(x => x.topic === 'organisation').map(x => x.value)].join(' ')
      const household = ev.items.filter(e => e.origin === 'household')
      if (!household.some(e => overlaps(claim, e.text))) out.push({
        kind: 'statement_evidence', topic: 'appointment', peripheral: false, turn,
        summary: 'Nothing on record matches the arrangement the visitor described', earlierQuote: '', nowQuote: c.quote,
      })
    }
  }
  return out
}

/** Words that must never appear in a question put to a visitor: the resident's name and every household-side detail. */
export function householdTerms(ev: EvidenceBundle, residentName?: string | null): string[] {
  const words = new Set<string>()
  for (const t of tokens(residentName ?? '')) words.add(t)
  for (const e of ev.items) if (e.origin === 'household') for (const t of tokens(e.text)) if (t.length > 3) words.add(t)
  return [...words]
}
