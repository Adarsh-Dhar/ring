import { HELPERS, DEFAULT_ESCALATION_SECONDS, RESULT_TTL_MS, NO_RESPONSE_TTL_MS, CHECKIN_HOUR, CHECKIN_GRACE_MIN, type Helper, type Consent } from './config'
import { pushToSubs, sendSms, type PushSub } from './notify'
import { loadState, saveSoon } from './persist'

export type CaseStatus = 'waiting' | 'answered' | 'no_response'
export type Answer = 'safe' | 'not_safe' | 'call_me'
export type CaseKind = 'visitor' | 'sos'
export type Visitor = 'known' | 'delivery' | 'unknown'

export interface Quiet { enabled: boolean; startHour: number; endHour: number }

export interface ExpectedVisit {
  id: string
  icon: string
  label: string
  startsAt: number
  endsAt: number
}

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
  visitor?: Visitor
  confirmedAt?: number
  declinedAt?: number
  chain: string[]
}

interface DoorbellState {
  cases: DoorCase[]
  offline: boolean
  timeoutSec: number
  subs: Record<string, PushSub[]>
  expected: ExpectedVisit[]
  checkinAt: number | null
  missedAlertDay: string | null
  helpers: Helper[]
  quiet: Quiet
}

function restore(): Partial<DoorbellState> {
  const s = loadState<DoorbellState>()
  const known = (s.helpers ?? HELPERS).filter((h) => h.consent === 'approved').map((h) => h.id)
  for (const c of s.cases ?? []) {
    if (c.status === 'waiting') {
      c.status = 'no_response'
      c.resolvedAt = Date.now()
      c.log.push({ t: Date.now(), msg: 'Server restarted while this case was open. Closed without alerts.' })
    }
    c.chain ||= known
  }
  return s
}

const g = globalThis as unknown as { __doorbell?: DoorbellState }
const state: DoorbellState = (g.__doorbell ||= {
  cases: [],
  offline: false,
  timeoutSec: DEFAULT_ESCALATION_SECONDS,
  subs: {},
  expected: [],
  checkinAt: null,
  missedAlertDay: null,
  helpers: HELPERS.map((h) => ({ ...h })),
  quiet: { enabled: false, startHour: 22, endHour: 6 },
  ...restore(),
})
state.subs ||= {}
state.expected ||= []
state.checkinAt ??= null
state.missedAlertDay ??= null
state.helpers ||= HELPERS.map((h) => ({ ...h }))
state.quiet ||= { enabled: false, startHour: 22, endHour: 6 }
const persist = () => saveSoon(() => state)

const TRIGGER_EVENTS = new Set(
  (process.env.RING_TRIGGER_EVENTS || 'person_detected,doorbell_pressed,ding').split(',').map((s) => s.trim()).filter(Boolean)
)

const id = () => `case_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

export function addSub(helperId: string, sub: PushSub) {
  const list = (state.subs[helperId] ||= [])
  if (!list.some((s) => s.endpoint === sub.endpoint)) list.push(sub)
  persist()
}
export function removeSub(helperId: string, endpoint: string) {
  state.subs[helperId] = (state.subs[helperId] || []).filter((s) => s.endpoint !== endpoint)
  persist()
}

function notifyHelper(h: Helper, title: string, body: string, caseId: string) {
  const subs = state.subs[h.id] || []
  void pushToSubs(subs, { title, body, tag: caseId, url: `/helper?as=${h.id}` })
    .then((dead) => dead.forEach((e) => removeSub(h.id, e)))
    .catch((e) => console.error('[PUSH]', e))
}
function notifyAll(title: string, body: string, caseId: string) {
  approvedHelpers().forEach((h) => notifyHelper(h, title, body, caseId))
}

const approvedHelpers = () => state.helpers.filter((h) => h.consent === 'approved')
const findHelper = (id: string) => state.helpers.find((h) => h.id === id)
export const getHelper = (id: string) => findHelper(id)

function isQuiet(now: number): boolean {
  const q = state.quiet
  if (!q.enabled || q.startHour === q.endHour) return false
  const h = new Date(now).getHours()
  return q.startHour < q.endHour ? h >= q.startHour && h < q.endHour : h >= q.startHour || h < q.endHour
}

const RESIDENT = process.env.RESIDENT_NAME || 'the resident'

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
const dueAt = (now: number) => {
  const d = new Date(now)
  d.setHours(CHECKIN_HOUR, 0, 0, 0)
  return d.getTime()
}
const checkedInToday = (now: number) =>
  state.checkinAt !== null && dayKey(new Date(state.checkinAt)) === dayKey(new Date(now))

function checkMissedCheckin(now: number) {
  const key = dayKey(new Date(now))
  const late = now >= dueAt(now) + CHECKIN_GRACE_MIN * 60_000
  if (!late || checkedInToday(now) || state.missedAlertDay === key) return
  state.missedAlertDay = key
  notifyAll('⚠️ No check-in today', `${RESIDENT} has not pressed "I'm OK" yet. Please call.`, `checkin-${key}`)
  smsAll(`${RESIDENT} has not checked in today. Please call.`)
  persist()
}

function smsAll(body: string) {
  approvedHelpers().forEach((h) => {
    void sendSms(h.phone, body)
  })
}

function alertSos(c: DoorCase) {
  notifyAll('🆘 Resident needs help', 'Open the app now.', c.id)
  smsAll(`${RESIDENT} pressed "I need help". Please call now.`)
  addLog(c, 'Push and SMS sent to all helpers.')
}

const addLog = (c: DoorCase, msg: string) => {
  c.log.push({ t: Date.now(), msg })
  persist()
}

export function tick(now = Date.now()) {
  for (const c of state.cases) {
    if (c.status !== 'waiting') continue
    while (c.status === 'waiting' && now >= c.deadlineAt) {
      const fromId = c.chain[c.helperIndex]
      const from = findHelper(fromId)
      c.helperIndex += 1
      if (c.helperIndex >= c.chain.length) {
        c.status = 'no_response'
        c.resolvedAt = c.deadlineAt
        addLog(c, `${from?.name ?? 'Someone'} did not answer. Nobody left to ask. Resident told to keep door closed.`)
        smsAll(`Doorbell: nobody answered for ${RESIDENT}. Please call them now.`)
        addLog(c, 'SMS sent to all helpers.')
      } else {
        const toId = c.chain[c.helperIndex]
        const to = findHelper(toId)
        c.deadlineAt += state.timeoutSec * 1000
        addLog(c, `${from?.name ?? 'Someone'} did not answer in ${state.timeoutSec}s. Escalated to ${to?.name ?? 'next helper'}.`)
        if (to) notifyHelper(to, `🚪 ${from?.name ?? 'Someone'} did not answer`, 'It is your turn. Open the app.', c.id)
      }
    }
  }
  checkMissedCheckin(now)
}

function activeCase(now = Date.now()): DoorCase | null {
  const c = state.cases[0]
  if (!c) return null
  if (c.status === 'waiting') return c
  const awaitingConfirm = c.status === 'answered' && c.answer === 'safe' && !c.confirmedAt && !c.declinedAt
  const age = now - (c.resolvedAt ?? c.createdAt)
  const ttl = c.status === 'no_response' || awaitingConfirm ? NO_RESPONSE_TTL_MS : RESULT_TTL_MS
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
    chain: approvedHelpers().map((h) => h.id),
  }
  addLog(c, note)
  const exp = state.expected.find((e) => e.startsAt <= now && now < e.endsAt)
  if (exp) addLog(c, `Expected now: ${exp.label}.`)
  const approved = approvedHelpers()
  addLog(c, `Asked ${approved[0]?.name ?? 'a helper'}. ${state.timeoutSec}s to answer.`)
  if (kind === 'visitor' && approved[0]) notifyHelper(approved[0], '🚪 Someone is at the door', `Open the app. You have ${state.timeoutSec}s.`, c.id)
  state.cases.unshift(c)
  if (state.cases.length > 200) state.cases.pop()
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
    if (existing.kind === 'sos') return existing
    existing.kind = 'sos'
    addLog(existing, 'Resident pressed "I need help".')
    alertSos(existing)
    return existing
  }
  const c = openCase('sos', 'sos', null, 'Resident pressed "I need help".')
  alertSos(c)
  return c
}

export function addExpected(icon: string, label: string, startsAt: number, endsAt: number): ExpectedVisit {
  const e = { id: `exp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, icon, label, startsAt, endsAt }
  state.expected.push(e)
  persist()
  return e
}
export function removeExpected(id: string) {
  state.expected = state.expected.filter((e) => e.id !== id)
  persist()
}

export function checkIn() {
  state.checkinAt = Date.now()
  persist()
}

export function answerCase(caseId: string, helperId: string, answer: Answer, visitor?: Visitor): DoorCase | null {
  tick()
  const c = state.cases.find((x) => x.id === caseId)
  if (!c) return null
  if (c.status === 'answered') return c
  const helper = findHelper(helperId)
  c.status = 'answered'
  c.answer = answer
  c.visitor = visitor
  c.answeredBy = helperId
  c.resolvedAt = Date.now()
  const label = answer === 'safe' ? 'SAFE' : answer === 'not_safe' ? 'NOT SAFE' : 'will CALL the resident'
  addLog(c, `${helper?.name ?? helperId} answered: ${label}.`)
  return c
}

export function confirmCase(caseId: string, ok: boolean): DoorCase | null {
  const c = state.cases.find((x) => x.id === caseId)
  if (!c || c.status !== 'answered' || c.answer !== 'safe') return null
  if (ok && isQuiet(Date.now())) {
    c.declinedAt = Date.now()
    c.resolvedAt = Date.now()
    addLog(c, 'Night lock is on. The door stays closed.')
    return c
  }
  if (ok) c.confirmedAt = Date.now()
  else c.declinedAt = Date.now()
  c.resolvedAt = Date.now()
  addLog(c, ok ? 'Resident confirmed: opening the door.' : 'Resident chose to keep the door closed.')
  return c
}

export function getState() {
  tick()
  const now = Date.now()
  return {
    now,
    timeoutSec: state.timeoutSec,
    offline: state.offline,
    helpers: approvedHelpers(),
    current: activeCase(now),
    history: state.cases.slice(0, 10),
    expected: state.expected.filter((e) => e.endsAt > now),
    expectedNow: state.expected.filter((e) => e.startsAt <= now && now < e.endsAt),
    checkin: { doneToday: checkedInToday(now), dueHour: CHECKIN_HOUR },
    quietNow: isQuiet(now),
  }
}

export function getHistory() {
  tick()
  return { helpers: state.helpers, cases: state.cases }
}

export const getSetup = () => ({ helpers: state.helpers, quiet: state.quiet, timeoutSec: state.timeoutSec })

export function addHelper(name: string, phone: string, emoji: string): Helper {
  const h: Helper = { id: `h_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name, phone, emoji, consent: 'pending' }
  state.helpers.push(h)
  persist()
  return h
}
export function removeHelper(id: string): boolean {
  const h = findHelper(id)
  if (!h) return false
  if (h.consent === 'approved' && approvedHelpers().length <= 1) return false
  state.helpers = state.helpers.filter((x) => x.id !== id)
  delete state.subs[id]
  persist()
  return true
}
export function setConsent(id: string, consent: Consent): boolean {
  const h = findHelper(id)
  if (!h) return false
  if (h.consent === 'approved' && consent !== 'approved' && approvedHelpers().length <= 1) return false
  h.consent = consent
  h.consentAt = Date.now()
  persist()
  return true
}
export function moveHelper(id: string, dir: -1 | 1) {
  const i = state.helpers.findIndex((h) => h.id === id), j = i + dir
  if (i < 0 || j < 0 || j >= state.helpers.length) return
  ;[state.helpers[i], state.helpers[j]] = [state.helpers[j], state.helpers[i]]
  persist()
}
export function setQuiet(q: Quiet) {
  state.quiet = { enabled: !!q.enabled, startHour: q.startHour, endHour: q.endHour }
  persist()
}

export function setOffline(v: boolean) {
  state.offline = v
  persist()
}
export function setTimeoutSec(n: number) {
  state.timeoutSec = Math.max(3, Math.min(600, Math.floor(n)))
  persist()
}
export function resetAll() {
  state.cases.length = 0
  state.offline = false
  persist()
}

// Server-side timer for escalation without a tab open
const gt = globalThis as unknown as { __doorbellTimer?: ReturnType<typeof setInterval> }
if (!gt.__doorbellTimer) {
  gt.__doorbellTimer = setInterval(() => tick(), 1000)
  gt.__doorbellTimer.unref?.()
}
