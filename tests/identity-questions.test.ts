/**
 * A visitor who says they know the resident is asked who they are, and the helper card shows who they CLAIM to be.
 * Pure functions only: no model, no database.
 */
import { describe, it, expect } from 'vitest'
import { foldCaseFile, type InterrogationTurn, type StoredAnalysis } from '@/lib/ai/interrogation/casefile'
import { allowedTactics, chooseMove } from '@/lib/ai/interrogation/playbook'
import { identityObjectiveDue, claimedIdentityOf, claimsBlock } from '@/lib/ai/interrogation/identity'

const A = (o: Partial<StoredAnalysis> = {}): StoredAnalysis => ({
  understood: true, strategy: 'unclear', counterTactic: null, commitments: [], inconsistencies: [], behaviours: [],
  wellbeing: { vulnerable: false, needsHelp: false, note: null }, claimsOrganisation: false, claimsPersonalTie: false,
  claimsAppointment: false, evasive: false, satisfied: false, riskHint: 'none', ...o,
})
const T = (transcript: string, analysis: StoredAnalysis): InterrogationTurn => ({ question: 'q', transcript, timestamp: 1, next: 'next', analysis })
const C = (topic: any, specificity: any, o: any = {}) => ({ topic, value: 'v', specificity, checkable: false, quote: 'q', count: null, turn: 0, ...o })
const ctx = (turns: InterrogationTurn[], o: any = {}) => ({ file: foldCaseFile(turns), understood: true, counterTactic: null, fact: null, questionsLeft: 0, ...o })

// What the user saw: "Let me in", then "i am a friend of adarsh".
const friend = [
  T('Let me in', A()),
  T('i am a friend of adarsh', A({
    claimsPersonalTie: true,
    claims: { name: null, organisation: null, reason: null, forWhom: 'adarsh', time: null, relation: 'friend' },
    commitments: [C('relation', 'specific', { value: 'friend' }), C('target', 'specific', { value: 'adarsh' })],
  })),
]

describe('asking a visitor who says they know the resident for their name', () => {
  it('the name comes first, even when the operator question ceiling is used up', () => {
    expect(identityObjectiveDue(foldCaseFile(friend))).toBe('name')
    expect(allowedTactics(ctx(friend))).toEqual(['probe_specifics'])
  })

  it('overrides whatever the model proposed (close, or another topic)', () => {
    const c1 = chooseMove({ tactic: 'close', objective: null, rationale: '' }, ctx(friend))
    expect(c1.move).toMatchObject({ tactic: 'probe_specifics', objective: 'name' })
    expect(c1.overridden).toBe(true)
    const c2 = chooseMove({ tactic: 'probe_specifics', objective: 'purpose', rationale: '' }, ctx(friend))
    expect(c2.move.objective).toBe('name')
  })

  it('keeps the model\'s own proposal when it already asks for the name', () => {
    const c = chooseMove({ tactic: 'probe_specifics', objective: 'name', rationale: 'r' }, ctx(friend))
    expect(c.overridden).toBe(false)
  })

  it('asks once only: after the name question was asked it is not pressed again', () => {
    const asked = [...friend.slice(0, 1), { ...friend[1], analysis: A({ ...friend[1].analysis!, move: { tactic: 'probe_specifics', objective: 'name', rationale: '' } }) }]
    expect(identityObjectiveDue(foldCaseFile(asked))).toBeNull()
  })

  it('moves on to how they know the resident when that is still open', () => {
    const t = [T('I am Ravi, I know the family', A({
      claimsPersonalTie: true, commitments: [C('name', 'specific', { value: 'Ravi' })],
    }))]
    expect(identityObjectiveDue(foldCaseFile(t))).toBe('relation')
  })

  it('does nothing when the name is already given', () => {
    const t = [T('I am Ravi Kumar, a friend of adarsh', A({
      claimsPersonalTie: true,
      commitments: [C('name', 'specific', { value: 'Ravi Kumar' }), C('relation', 'specific', { value: 'friend' })],
    }))]
    expect(identityObjectiveDue(foldCaseFile(t))).toBeNull()
  })

  it('never presses after a decline, and never fires for visitors who claim no tie', () => {
    const declined = [...friend, T('why do you need that', A({ counterTactic: 'question_back' }))]
    expect(identityObjectiveDue(foldCaseFile(declined))).toBeNull()
    expect(chooseMove(null, ctx(declined, { counterTactic: 'question_back' })).move.tactic).not.toBe('probe_specifics')
    expect(identityObjectiveDue(foldCaseFile([T('delivery for the house', A())]))).toBeNull()
  })

  it('waits for the audio to be understood first', () => {
    expect(chooseMove(null, ctx(friend, { understood: false })).move.tactic).toBe('clarify_audio')
  })
})

describe('who the visitor claims to be (shown with the risk score)', () => {
  const analyses = friend.map(t => t.analysis!)
  const said = friend.map(t => t.transcript).join(' ')

  it('shows a missing name plainly and labels the whole thing unverified', () => {
    const id = claimedIdentityOf(analyses, said)!
    expect(id).toMatchObject({ name: null, nameStatus: 'not_given', relation: 'friend', forWhom: 'adarsh', verified: false })
    expect(id.summary).toBe('Name not given yet. Says they know adarsh (friend). Not verified.')
  })

  it('shows the name once it is given', () => {
    const more = [...analyses, A({ claims: { name: 'Ravi Kumar', organisation: null, reason: null, forWhom: null, time: null }, commitments: [C('name', 'specific', { value: 'Ravi Kumar' })] })]
    const id = claimedIdentityOf(more, said + ' my name is Ravi Kumar')!
    expect(id.name).toBe('Ravi Kumar')
    expect(id.nameStatus).toBe('given')
    expect(id.summary.startsWith('Ravi Kumar. Says they know adarsh (friend)')).toBe(true)
  })

  it('drops a name the model reports that the visitor never said', () => {
    const made = [A({ claimsPersonalTie: true, claims: { name: 'Totally Invented', organisation: null, reason: null, forWhom: null, time: null, relation: 'friend' } })]
    expect(claimedIdentityOf(made, 'i am a friend')!.name).toBeNull()
  })

  it('records a declined name, and shows nothing for a visitor who claimed nothing', () => {
    const declined = [A({ claimsPersonalTie: true, commitments: [C('name', 'refused', { value: '', quote: '' })] })]
    expect(claimedIdentityOf(declined, 'no')!.summary.startsWith('Declined to give a name')).toBe(true)
    expect(claimedIdentityOf([A()], 'hello')).toBeNull()
  })

  it('claimsBlock keeps the old claim fields and adds the identity', () => {
    const b = claimsBlock(analyses, said)
    expect(b.forWhom).toBe('adarsh')
    expect(b.identity?.relation).toBe('friend')
  })
})
