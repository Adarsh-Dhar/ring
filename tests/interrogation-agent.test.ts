/**
 * The interviewer agent, tested with fake model calls: no network, no database.
 * Scenario follows the SUE flow from the research report, adapted to a doorstep.
 */
import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/ai/client', () => ({ generateJson: vi.fn(async () => null), embed: vi.fn(async () => null) }))

import { foldPlan, requiredSlots, coverageSummary, coverageFacts, isSatisfied } from '@/lib/ai/interrogation/plan'
import { foldCaseFile, planStateOf, isStalled, type InterrogationTurn, type StoredAnalysis } from '@/lib/ai/interrogation/casefile'
import { allowedTactics, chooseMove } from '@/lib/ai/interrogation/playbook'
import { efmQuadrant, alignWithEvidence, nextDisclosableFact, householdTerms, type EvidenceBundle } from '@/lib/ai/interrogation/evidence'
import { structuralCheck } from '@/lib/ai/interrogation/guardrails'
import { analyseTurn, composeQuestion, riskEvidenceOf, type EngineDeps } from '@/lib/ai/interrogation/engine'
import type { TurnAnalysisRaw } from '@/lib/ai/interrogation/schemas'

const A = (o: Partial<StoredAnalysis> = {}): StoredAnalysis => ({
  understood: true, strategy: 'unclear', counterTactic: null, commitments: [], inconsistencies: [], behaviours: [],
  wellbeing: { vulnerable: false, needsHelp: false, note: null }, claimsOrganisation: false, claimsPersonalTie: false,
  claimsAppointment: false, evasive: false, satisfied: false, riskHint: 'none', ...o,
})
const T = (transcript: string, analysis: StoredAnalysis, next: string | null = null): InterrogationTurn => ({ question: 'q', transcript, timestamp: 1, next, analysis })
const C = (topic: any, specificity: any, o: any = {}) => ({ topic, value: 'v', specificity, checkable: false, quote: 'q', count: null, turn: 0, ...o })
const noEvidence: EvidenceBundle = { items: [], householdChecked: false }

const raw = (o: Partial<TurnAnalysisRaw> = {}): TurnAnalysisRaw => ({
  transcript: '', understood: true, transcriptQuality: null,
  claims: { name: null, organisation: null, reason: null, forWhom: null, time: null },
  commitments: [], inconsistencies: [], behaviours: [], strategy: 'unclear', counterTactic: null,
  wellbeing: { vulnerable: false, needsHelp: false, note: null }, claimsOrganisation: false, claimsPersonalTie: false,
  claimsAppointment: false, evasive: false, satisfied: false, riskHint: 'none', verdict: 'unclear', realReasonSummary: null,
  move: null, utterance: null, ...o,
})
const deps = (r: TurnAnalysisRaw | null, speakQueue: (string | null)[] = [], judge: (t: string) => boolean = () => true): EngineDeps & { spoke: string[] } => {
  const spoke: string[] = []
  return {
    spoke,
    analyse: async () => r,
    speak: async () => { const s = speakQueue.shift() ?? null; if (s) spoke.push(s); return s },
    vet: async (i) => judge(i.text)
      ? { ok: true, log: { verdict: 'pass', attempts: i.attempts, violations: [] } }
      : { ok: false, log: { verdict: 'fail', attempts: i.attempts, violations: [{ rule: 'accusation', reason: 'x' }] } },
  }
}

describe('coverage bookkeeping', () => {
  it('requires purpose, name, proof; adds organisation/appointment when claimed', () => {
    const s = foldPlan([{ claimsOrg: true, claimsAppointment: true }])
    const r = requiredSlots(s, 1)
    expect(r).toEqual(expect.arrayContaining(['purpose', 'name', 'proof', 'organisation', 'appointment']))
  })
  it('missing after asking shows as vague; declines are notes, not scored facts', () => {
    const s = foldPlan([{ focus: 'proof' }, { obs: { purpose: 'specific' }, claimsOrg: true }])
    expect(coverageSummary(s, 2).find(i => i.slot === 'proof')?.status).toBe('vague')
    expect(coverageFacts(s, 2).unverifiable).toBe(true)
    expect(isSatisfied(s, 2)).toBe(false)
  })
})

describe('case file', () => {
  it('builds the commitment ledger, strategy trail and phase from stored turns', () => {
    const f = foldCaseFile([
      T('a', A({ strategy: 'avoidance', commitments: [C('purpose', 'vague')] }), 'next'),
      T('b', A({ strategy: 'forthcoming', commitments: [C('name', 'specific', { turn: 1 }), C('organisation', 'specific', { turn: 1 })] })),
    ])
    expect(f.answered).toBe(2)
    expect(f.strategies).toEqual(['avoidance', 'forthcoming'])
    expect(f.latest.name?.specificity).toBe('specific')
    expect(f.phase).toBe('commitment')
    expect(planStateOf(f).status.recheck).toBe('specific')
  })
  it('a clarify move closes the inconsistency it asked about', () => {
    const inc = { kind: 'within_statement' as const, topic: 'organisation' as const, summary: 's', earlierQuote: 'a', nowQuote: 'b', peripheral: false, turn: 1 }
    const open = foldCaseFile([T('x', A()), T('y', A({ inconsistencies: [inc] }))])
    expect(open.open).toHaveLength(1)
    expect(open.phase).toBe('challenge')
    const asked = foldCaseFile([T('x', A()), T('y', A({ inconsistencies: [inc], move: { tactic: 'consistency_clarify', objective: 'organisation', rationale: '' } }))])
    expect(asked.open).toHaveLength(0)
  })
  it('peripheral slips never open a challenge', () => {
    const inc = { kind: 'within_statement' as const, topic: 'spatial' as const, summary: 's', earlierQuote: 'a', nowQuote: 'b', peripheral: true, turn: 0 }
    expect(foldCaseFile([T('y', A({ inconsistencies: [inc] }))]).open).toHaveLength(0)
  })
  it('two declines in a row stop the interview', () => {
    const d = A({ counterTactic: 'no_comment', strategy: 'counter_tactic' })
    expect(isStalled(foldCaseFile([T('no', d), T('no', d)]))).toBe(true)
    expect(isStalled(foldCaseFile([T('no', d), T('ok', A({ commitments: [C('name', 'specific')] }))]))).toBe(false)
  })
  it('reads turns written before the rewrite', () => {
    const f = foldCaseFile([{ question: 'q', transcript: 't', timestamp: 1, obs: { purpose: 'vague' }, focus: 'purpose' }])
    expect(f.latest.purpose?.specificity).toBe('vague')
    expect(f.asks.purpose).toBe(1)
  })
})

describe('playbook', () => {
  const ctx = (file = foldCaseFile([]), o: any = {}) => ({ file, understood: true, counterTactic: null, fact: null, questionsLeft: null, ...o })
  it('a decline only allows autonomy support or close, never pressing', () => {
    expect(allowedTactics(ctx(undefined, { counterTactic: 'no_comment' }))).toEqual(['autonomy_support', 'close'])
  })
  it('not understood -> only clarify_audio', () => {
    expect(allowedTactics(ctx(undefined, { understood: false }))).toEqual(['clarify_audio'])
  })
  it('evidence_frame needs a visitor-side fact AND a prior commitment', () => {
    const fact: any = { id: 'cam:people', fact: 'x' }
    expect(allowedTactics(ctx(undefined, { fact }))).not.toContain('evidence_frame')
    const f = foldCaseFile([T('a', A({ commitments: [C('purpose', 'vague')] }))])
    expect(allowedTactics(ctx(f, { fact }))).toContain('evidence_frame')
    expect(allowedTactics(ctx(f))).not.toContain('evidence_frame')
  })
  it('consistency_clarify only exists when something central really conflicted', () => {
    expect(allowedTactics(ctx())).not.toContain('consistency_clarify')
  })
  it('never presses a declined verification request', () => {
    const f = foldCaseFile([T('a', A({ commitments: [C('proof', 'refused')] }))])
    expect(allowedTactics(ctx(f))).not.toContain('verification_request')
  })
  it('overrides a disallowed proposal and says why; accepts an allowed one', () => {
    const c = chooseMove({ tactic: 'evidence_frame', objective: null, rationale: '' }, ctx())
    expect(c.overridden).toBe(true)
    expect(c.move.tactic).not.toBe('evidence_frame')
    expect(chooseMove({ tactic: 'unanticipated_logistics', objective: 'spatial', rationale: 'r' }, ctx()).overridden).toBe(false)
  })
  it('refuses to repeat the same move on the same objective', () => {
    const f = foldCaseFile([T('a', A({ move: { tactic: 'probe_specifics', objective: 'purpose', rationale: '' } }))])
    expect(chooseMove({ tactic: 'probe_specifics', objective: 'purpose', rationale: '' }, ctx(f)).overridden).toBe(true)
  })
})

describe('evidence framing matrix', () => {
  it('classifies the four quadrants', () => {
    expect(efmQuadrant('weak', 'low')).toBe('LS/WS')
    expect(efmQuadrant('weak', 'high')).toBe('HS/WS')
    expect(efmQuadrant('strong', 'low')).toBe('LS/SS')
    expect(efmQuadrant('strong', 'high')).toBe('HS/SS')
  })
  const cam = (): EvidenceBundle => ({ householdChecked: true, items: [
    { id: 'cam:description', kind: 'camera_description', origin: 'visitor_side', strength: 'strong', specificity: 'high', quadrant: 'HS/SS', fact: 'desc', text: '' },
    { id: 'cam:people', kind: 'camera_people', origin: 'visitor_side', strength: 'strong', specificity: 'low', quadrant: 'LS/SS', fact: 'two people', text: '', count: 2 },
    { id: 'visit:0', kind: 'known_visit', origin: 'household', strength: 'strong', specificity: 'high', quadrant: 'HS/SS', fact: 'secret', text: 'thames water meter' },
  ] })
  it('discloses incrementally (low specificity first), visitor-side only', () => {
    expect(nextDisclosableFact(cam().items, [])?.id).toBe('cam:people')
    expect(nextDisclosableFact(cam().items, ['cam:people'])?.id).toBe('cam:description')
    expect(nextDisclosableFact(cam().items, ['cam:people', 'cam:description'])).toBeNull()
  })
  it('flags "alone" against two people on camera, silently', () => {
    const out = alignWithEvidence([C('companions', 'specific', { count: 0, quote: 'just me' })], [], cam(), 0)
    expect(out[0].kind).toBe('statement_evidence')
  })
  it('flags a claimed arrangement that matches nothing on record, and accepts one that does', () => {
    expect(alignWithEvidence([C('appointment', 'specific', { value: 'boiler service' })], [], cam(), 0)).toHaveLength(1)
    expect(alignWithEvidence([C('appointment', 'specific', { value: 'water meter reading' })], [], cam(), 0)).toHaveLength(0)
  })
  it('does not claim "no record" when nothing could be checked', () => {
    expect(alignWithEvidence([C('appointment', 'specific', { value: 'x thing' })], [], noEvidence, 0)).toHaveLength(0)
  })
  it('household words are blocked from speech, camera facts are not', () => {
    const terms = householdTerms(cam(), 'Margaret Hill')
    expect(terms).toEqual(expect.arrayContaining(['margaret', 'thames', 'meter']))
    expect(structuralCheck('Is Margaret expecting you?', { householdTerms: terms })).toContain('household_term')
    expect(structuralCheck('Which company are you with?', { householdTerms: terms })).toEqual([])
  })
})

describe('structural guardrails', () => {
  it('rejects long lines, double questions, empty text', () => {
    const t: string[] = []
    expect(structuralCheck('', { householdTerms: t })).toContain('empty')
    expect(structuralCheck('Who sent you? What is your name?', { householdTerms: t })).toContain('more_than_one_question')
    expect(structuralCheck(Array(30).fill('word').join(' '), { householdTerms: t })).toContain('too_long')
  })
})

describe('engine: SUE flow', () => {
  const base = { householdId: 'h', caseId: 'c', asked: 'Who are you?', evidence: noEvidence, questionsLeft: null as number | null }

  it('drops claims whose quote is not in the transcript (no invented evidence)', async () => {
    const r = await analyseTurn({ ...base, turns: [], answer: { typed: 'I am Sam from Acme Gas' } }, deps(raw({
      commitments: [
        { topic: 'organisation', value: 'Acme Gas', specificity: 'specific', checkable: true, quote: 'Sam from Acme Gas', count: null },
        { topic: 'proof', value: 'badge 7', specificity: 'specific', checkable: true, quote: 'badge number seven', count: null },
        { topic: 'bogus', value: 'x', specificity: 'specific', checkable: false, quote: 'Acme', count: null },
      ],
      behaviours: [{ category: 'credential_request', quote: 'tell me your PIN' }],
    })))
    expect(r!.analysis.commitments.map(c => c.topic)).toEqual(['organisation'])
    expect(r!.analysis.behaviours).toHaveLength(0)
  })

  it('a typed answer is the transcript, whatever the model claims it heard', async () => {
    const r = await analyseTurn({ ...base, turns: [], answer: { typed: 'parcel for number 4' } }, deps(raw({ transcript: 'something else' })))
    expect(r!.transcript).toBe('parcel for number 4')
  })

  it('detects a changed story from two verbatim quotes and challenges neutrally, once', async () => {
    const turns = [T('I am from the council', A({ commitments: [C('organisation', 'vague', { quote: 'from the council' })] }), 'Which department?')]
    const inc = { topic: 'organisation', earlierQuote: 'from the council', nowQuote: 'from Bright Roofing', summary: 'Council, then a roofing firm', peripheral: false }
    const r = (await analyseTurn({ ...base, turns, answer: { typed: 'Actually I am from Bright Roofing' } },
      deps(raw({ inconsistencies: [inc], move: { tactic: 'consistency_clarify', objective: 'organisation', rationale: 'org changed' }, utterance: 'Earlier you said the council, now Bright Roofing. Which is right?' }))))!
    expect(r.inconsistent).toBe(true)
    expect(r.file.open).toHaveLength(1)
    expect(riskEvidenceOf([r.analysis]).filter(e => e.category === 'purpose_contradiction')).toHaveLength(2)
    const d = deps(null)
    const c = await composeQuestion({ householdId: 'h', caseId: 'c', result: r, questionsLeft: null, householdTerms: [], spoken: [], lastExchange: null }, d)
    expect(c.kind).toBe('ask')
    if (c.kind === 'ask') expect(c.move.tactic).toBe('consistency_clarify')
  })

  it('an ungrounded contradiction is discarded', async () => {
    const turns = [T('I am from the council', A())]
    const r = await analyseTurn({ ...base, turns, answer: { typed: 'Bright Roofing' } }, deps(raw({
      inconsistencies: [{ topic: 'organisation', earlierQuote: 'from the gas board', nowQuote: 'Bright Roofing', summary: 's', peripheral: false }],
    })))
    expect(r!.inconsistent).toBe(false)
  })

  it('a decline gets autonomy support, not pressure', async () => {
    const r = (await analyseTurn({ ...base, turns: [], answer: { typed: 'no comment' } }, deps(raw({
      counterTactic: 'no_comment', move: { tactic: 'verification_request', objective: 'proof', rationale: 'push' }, utterance: 'Show me ID now.',
    }))))!
    const c = await composeQuestion({ householdId: 'h', caseId: 'c', result: r, questionsLeft: null, householdTerms: [], spoken: [], lastExchange: null },
      deps(null, ['That is completely your choice. Say as much or as little as you like.']))
    expect(c.kind).toBe('ask')
    if (c.kind === 'ask') { expect(c.move.tactic).toBe('autonomy_support'); expect(c.text).not.toMatch(/show me/i) }
  })

  it('regenerates a line the guardrail rejects, with a different line, then passes', async () => {
    const r = (await analyseTurn({ ...base, turns: [], answer: { typed: 'delivering a parcel' } }, deps(raw({
      move: { tactic: 'probe_specifics', objective: 'detail', rationale: '' }, utterance: 'Are you lying about the parcel?',
    }))))!
    const d = deps(null, ['Which company is the parcel from?'], t => !t.includes('lying'))
    const c = await composeQuestion({ householdId: 'h', caseId: 'c', result: r, questionsLeft: null, householdTerms: [], spoken: [], lastExchange: null }, d)
    expect(c.kind).toBe('ask')
    if (c.kind === 'ask') { expect(c.text).toBe('Which company is the parcel from?'); expect(c.guardrail.attempts).toBe(2) }
  })

  it('hands over to a carer if no line passes. It never falls back to a script', async () => {
    const r = (await analyseTurn({ ...base, turns: [], answer: { typed: 'hello' } }, deps(raw({ move: { tactic: 'probe_specifics', objective: 'purpose', rationale: '' }, utterance: 'bad' }))))!
    const d = deps(null, ['bad two', 'bad three', 'bad four'], () => false)
    const c = await composeQuestion({ householdId: 'h', caseId: 'c', result: r, questionsLeft: null, householdTerms: [], spoken: [], lastExchange: null }, d)
    expect(c.kind).toBe('handoff')
  })

  it('never repeats a line already spoken', async () => {
    const r = (await analyseTurn({ ...base, turns: [], answer: { typed: 'hello' } }, deps(raw({ move: { tactic: 'probe_specifics', objective: 'purpose', rationale: '' }, utterance: 'What is the reason for your visit?' }))))!
    const c = await composeQuestion({ householdId: 'h', caseId: 'c', result: r, questionsLeft: null, householdTerms: [], spoken: ['What is the reason for your visit?'], lastExchange: null },
      deps(null, ['Which job brings you here today?']))
    expect(c.kind === 'ask' && c.text).toBe('Which job brings you here today?')
  })

  it('states a camera fact only through evidence_frame, one at a time, and records it as disclosed', async () => {
    const ev: EvidenceBundle = { householdChecked: false, items: [{ id: 'cam:people', kind: 'camera_people', origin: 'visitor_side', strength: 'strong', specificity: 'low', quadrant: 'LS/SS', fact: 'The doorbell camera sees 2 people at the door', text: '', count: 2 }] }
    const turns = [T('I am alone', A({ commitments: [C('companions', 'specific', { count: 0, quote: 'I am alone' })] }), 'q2')]
    const r = (await analyseTurn({ ...base, evidence: ev, turns, answer: { typed: 'Yes just me' } }, deps(raw({
      move: { tactic: 'evidence_frame', objective: 'companions', rationale: '' }, utterance: 'The camera sees two people at the door. Can you tell me about that?',
    }))))!
    const c = await composeQuestion({ householdId: 'h', caseId: 'c', result: r, questionsLeft: null, householdTerms: [], spoken: [], lastExchange: null }, deps(null))
    expect(c.kind === 'ask' && c.disclosed).toEqual(['cam:people'])
  })

  it('an unintelligible answer asks for a repeat instead of guessing', async () => {
    const r = (await analyseTurn({ ...base, turns: [], answer: { typed: 'mmf' } }, deps(raw({ understood: false }))))!
    const c = await composeQuestion({ householdId: 'h', caseId: 'c', result: r, questionsLeft: null, householdTerms: [], spoken: [], lastExchange: null }, deps(null))
    expect(c.kind).toBe('reprompt')
  })

  it('returns null when the model is down so the caller can hand over', async () => {
    expect(await analyseTurn({ ...base, turns: [], answer: { typed: 'hi' } }, deps(null))).toBeNull()
  })
})
