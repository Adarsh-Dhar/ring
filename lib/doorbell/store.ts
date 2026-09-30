import { HELPERS, DEFAULT_ESCALATION_SECONDS, RESULT_TTL_MS, NO_RESPONSE_TTL_MS } from './config'

export type CaseStatus = 'waiting' | 'answered' | 'no_response'
export type Answer = 'safe' | 'not_safe' | 'call_me'
export type CaseKind = 'visitor' | 'sos'

export interface DoorCase {
  id: string
  kind: CaseKind
  eventType: string
  clip: string | null
  createdAt: number
  helperIndex: number
  deadlineAt: number
  status: CaseStatus
  answer?: Answer
  answeredBy?: string
  resolvedAt?: number
  log: { t: number; msg: string }[]
}

interface DoorbellState {
  cases: DoorCase[]
  offline: boolean
  timeoutSec: number
}

const g = globalThis as unknown as { __doorbell?: DoorbellState }
const state: DoorbellState = (g.__doorbell ||= {
  cases: [],
  offline: false,
  timeoutSec: DEFAULT_ESCALATION_SECONDS,
})

const TRIGGER_EVENTS = new Set(['person_detected', 'doorbell_pressed', 'ding'])

const id = () => `case_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
const addLog = (c: DoorCase, msg: string) => c.log.push({ t: Date.now(), msg })

export function tick(now = Date.now()) {
  for (const c of state.cases) {
    if (c.status !== 'waiting') continue
    while (c.status === 'waiting' && now >= c.deadlineAt) {
      const from = HELPERS[c.helperIndex]
      c.helperIndex += 1
      if (c.helperIndex >= HELPERS.length) {
        c.status = 'no_response'
        c.resolvedAt = c.deadlineAt
        addLog(c, `${from.name} did not answer. Nobody left to ask. Resident told to keep door closed.`)
      } else {
        const to = HELPERS[c.helperIndex]
        c.deadlineAt += state.timeoutSec * 1000
        addLog(c, `${from.name} did not answer in ${state.timeoutSec}s. Escalated to ${to.name}.`)
      }
    }
  }
}

function activeCase(now = Date.now()): DoorCase | null {
  const c = state.cases[0]
  if (!c) return null
  if (c.status === 'waiting') return c
  const age = now - (c.resolvedAt ?? c.createdAt)
  const ttl = c.status === 'no_response' ? NO_RESPONSE_TTL_MS : RESULT_TTL_MS
  return age < ttl ? c : null
}

function openCase(kind: CaseKind, eventType: string, clip: string | null, note: string): DoorCase {
  const now = Date.now()
  const c: DoorCase = {
    id: id(),
    kind,
    eventType,
    clip,
    createdAt: now,
    helperIndex: 0,
    deadlineAt: now + state.timeoutSec * 1000,
    status: 'waiting',
    log: [],
  }
  addLog(c, note)
  addLog(c, `Asked ${HELPERS[0].name}. ${state.timeoutSec}s to answer.`)
  state.cases.unshift(c)
  if (state.cases.length > 30) state.cases.pop()
  return c
}

export function ingestEvent(event: { event_type: string; event_id?: string; raw?: any }): DoorCase | null {
  if (state.offline) return null
  if (!TRIGGER_EVENTS.has(event.event_type)) return null
  tick()
  const existing = activeCase()
  if (existing && existing.status === 'waiting') {
    addLog(existing, `Another ${event.event_type} event merged into this case (no second alert).`)
    return existing
  }
  const clip = event.raw?.data?.attributes?.demo_clip ?? event.raw?.demo_clip ?? null
  return openCase('visitor', event.event_type, clip, `Ring sent ${event.event_type}.`)
}

export function raiseSos(): DoorCase {
  tick()
  const existing = activeCase()
  if (existing && existing.status === 'waiting') {
    existing.kind = 'sos'
    addLog(existing, 'Resident pressed "I need help".')
    return existing
  }
  return openCase('sos', 'sos', null, 'Resident pressed "I need help".')
}

export function answerCase(caseId: string, helperId: string, answer: Answer): DoorCase | null {
  tick()
  const c = state.cases.find((x) => x.id === caseId)
  if (!c) return null
  if (c.status === 'answered') return c
  const helper = HELPERS.find((h) => h.id === helperId)
  c.status = 'answered'
  c.answer = answer
  c.answeredBy = helperId
  c.resolvedAt = Date.now()
  const label = answer === 'safe' ? 'SAFE' : answer === 'not_safe' ? 'NOT SAFE' : 'will CALL the resident'
  addLog(c, `${helper?.name ?? helperId} answered: ${label}.`)
  return c
}

export function getState() {
  tick()
  const now = Date.now()
  return {
    now,
    timeoutSec: state.timeoutSec,
    offline: state.offline,
    helpers: HELPERS,
    current: activeCase(now),
    history: state.cases.slice(0, 10),
  }
}

export function setOffline(v: boolean) {
  state.offline = v
}
export function setTimeoutSec(n: number) {
  state.timeoutSec = Math.max(3, Math.min(600, Math.floor(n)))
}
export function resetAll() {
  state.cases.length = 0
  state.offline = false
}
