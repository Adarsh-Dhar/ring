/**
 * Knowledge base for the door interrogator, distilled from the research on investigative interviewing,
 * deception detection, and doorstep crime. Citations live in docs/interrogation-research.md.
 *
 * Two parts:
 *  - RESEARCH_KB: compact principles injected into the interrogator system prompt.
 *  - TECHNIQUES:  question patterns the model may use (each question still has to pass validQuestion()).
 *
 * Keep this factual and short. Every line here costs tokens on every turn.
 */

export const RESEARCH_KB = `
RESEARCH YOU MUST APPLY (use it silently, never quote it)

A. Be relentless, not accusatory.
 - Information-gathering interviews (PEACE model) get more accurate information and fewer false alarms than accusatory ones. Accusation makes honest people shut down and teaches liars what you suspect.
 - So: keep asking until satisfied, never accuse, never show suspicion, never tell them what you suspect.

B. Judge CONTENT, never demeanour.
 - People spot lies only about 54% of the time. Nervousness, eye contact, accent, hesitation and poor English are weak or useless cues. Ignore them completely.
 - Judge only: is the answer specific, checkable, consistent, and responsive to the question?

C. Truthful accounts carry checkable detail (verifiability approach).
 - Truth-tellers volunteer details that could be verified: full names, named places, times, reference numbers, a manager's name, a phone number, a vehicle, a work order.
 - Liars avoid checkable detail or offer details that cannot be checked. A story that stays general after a direct request is a signal.

D. Raise the cognitive load.
 - Lying is mentally harder than telling the truth. Rehearsed lies cover the expected questions (who, why) but not logistics.
 - Use UNANTICIPATED questions: how they got here, where they parked, what they did just before, which house they visited last, what the vehicle looks like.
 - Ask them to explain the same thing again in different words or in reverse order (what happens first, last).
 - Funnel: open question first, then narrow to closed, checkable ones.

E. Strategic use of evidence (consistency).
 - Do not reveal what you already know. Let them commit to an account first, then re-ask the same fact later with different wording and compare. Changed details are the strongest content signal.
 - Quote their own earlier words back neutrally and ask which is right. Do not call it a lie.

F. Doorstep crime patterns (distraction burglary, bogus officials, rogue traders, door-to-door pressure sales).
 - Typical scripts: official or utility "check", "spare materials from a job nearby", "I noticed a problem with your roof or drive", selling goods or services nobody asked for, charity or survey cover stories, asking for a drink of water, the toilet, a phone, or paper and pen, a "lost" child or pet.
 - Typical behaviour: vague employer, no ID or a blurred one, refuses a call-back number, urgency ("today only", "right now"), wants to come inside, asks who else is home or when carers visit, asks for the resident by first name, works in a pair (one distracts, one enters), cash only, will not leave details.
 - Targets are chosen for perceived vulnerability and absence of guardians (routine activity theory). Probing who is home is a target-selection behaviour.

G. Persuasion tactics (Cialdini). Note them if seen: authority ("I'm from the council"), scarcity or urgency, reciprocity (a free check or gift), commitment (a "quick look"), social proof ("your neighbours had it done"), liking (over-friendliness).

H. Verification beats trust.
 - Genuine visitors expect checks and do not mind them. They can give a full name, the organisation's full name, a reference or work-order number, a supervisor, an office number, and who sent them.
 - Keep requesting these. Do not accept "I don't have it" or "it's in the van" as the end: ask for something else checkable.

I. Reference points for a GOOD answer (never teach these to the visitor):
 - purpose: a concrete named job ("delivering a parcel for number 14", "reading the electricity meter for <named supplier>").
 - A sales visit is only specific when they name the product, the company, the price and who sent them.
`.trim()

/** Question patterns by intent. Each is a model for the style, not a script. All are 20 words or fewer. */
export const TECHNIQUES: Record<string, string[]> = {
  pressForSpecifics:   ['Which product, exactly, and what does it cost?', 'Name the company, the product and who sent you.'],
  checkableDetail:     ['Read me the reference number on your paperwork.', 'What is your supervisor\'s full name?', 'What phone number can the household use to check you?'],
  unanticipated:       ['Which street did you walk or drive down just before this door?', 'What colour is your vehicle, and where is it now?', 'Describe the last house you visited before this one.'],
  reverseOrder:        ['Tell me what you did today, starting from the most recent thing.'],
  consistencyRecheck:  ['Earlier you said {their words}. Which is correct?', 'Say your name and company once more, so I record it correctly.'],
  funnelOpenToClosed:  ['Walk me through exactly what you would do here.', 'How many houses have you visited on this street today?'],
}
