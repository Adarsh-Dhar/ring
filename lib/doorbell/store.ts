import { DEFAULT_ESCALATION_SECONDS, DEFAULT_DECISION_SECONDS, DEFAULT_NO_RESPONSE_SECONDS, RESULT_TTL_MS, NO_RESPONSE_TTL_MS, CHECKIN_HOUR, CHECKIN_GRACE_MIN, EXPECTED_TIMEOUT_SECONDS, RECURRING_GRACE_MIN, CODE_MAX_ATTEMPTS, type PublicHelper, type Consent } from './config'
import { zonedHour, zonedDayKey, zonedHourOnSameDay, zonedWeekday, zonedDayNumber, zonedMinuteOnSameDay } from '../time'
import { fetchDeviceOnline, listDeviceIds, forceRefreshConnection, ringConfiguredForHousehold, getConnectionForHousehold } from '../ring/client'
import { pushToMembership, sendSms, recentFailures, type PushSub } from './notify'
import { getHousehold, getResidentEpoch, updateHousehold, getMembershipsForHousehold as dbGetMembershipsForHousehold } from '../db/households'
import { getMembership, getApprovedMemberships } from '../db/memberships'
import { createCase, getCase, getCasesForHousehold, getOpenCasesForHousehold, getActiveLifecycleCase, updateCase, deleteOldCases, claimEscalationStep, getOverdueCases } from '../db/cases'
import { escalateDueCase, type EscalationDeps } from './escalation'
import { backupTimeoutSec } from '@/lib/doorstep/helperEscalation'
import { effectiveModeFor, effectiveScore } from '@/lib/doorstep/collaborationController'
import { residentRequestSummary } from '@/lib/doorstep/residentStatus'
import { maxMode, modeRank as controlModeRank } from '@/lib/doorstep/riskRules'
import type { ControlMode } from '@/lib/doorstep/riskRules'
import { evaluateNotice, parseNoticeSettings, APPROVAL_RETRY_WINDOW_MS, type NoticeStatus, type NoticeSettings } from '../doorstep/noticePolicy'
import { governingTimer, normalizeTimerDeadlines, NO_ACTIVE_TIMER_SENTINEL_MS, type TimerDeadlineMap, type TimerKind } from '../doorstep/deadline'
import { getExpectedVisitsForHousehold, getActiveExpectedVisits, deleteExpectedVisit, deleteOldExpectedVisits, createExpectedVisit, getRecurringVisitsForHousehold, updateRecurringVisit, deleteRecurringVisit, createRecurringVisit, markExpectedUsed } from '../db/visits'
import { getDb } from '../db/client'
import { sweepRequests, cancelRequestForVisit } from './request-lifecycle'
import { currentCode } from '../visit-code'
import { newSecret } from '../visit-tokens'
import { PURPOSES, type Purpose } from './purposes'
import { reportError } from '../errors'
import { applyRiskEdit } from '../doorstep/caseRiskStore'
import { attachEvent, sweepQuietCases, getPriorSeriousEvents } from '../doorstep/caseLifecycle'
import { readStored } from '../doorstep/caseRisk'
import { RISK_RULES, type LifecycleState } from '../doorstep/riskRules'
import { contactHelper } from '../doorstep/contactLog'
import { createHelperRequest, markAcked, type HelperRequestKind } from '../doorstep/helperRequests'
import { chainFrom } from '../doorstep/chainOrder'
import { writeAudit, audit } from '../doorstep/audit'
import { buildHelperRequest, formatPushNotification, formatSms } from '../doorstep/requestContent'

// ── Types ────────────────────────────────────────────────────────────────────

export type CaseStatus  = 'waiting' | 'answered' | 'no_response'
export type Answer      = 'safe' | 'not_safe' | 'call_me'
export type CaseKind    = 'visitor' | 'sos'
export type Visitor     = 'known' | 'delivery' | 'unknown'
export type PlannedMode = 'helper' | 'resident' | 'all-helper'

export const PLANNED_MODES = ['helper', 'resident', 'all-helper'] as const
const asMode = (v: string | null | undefined): PlannedMode =>
  (PLANNED_MODES as readonly string[]).includes(v ?? '') ? (v as PlannedMode) : 'helper'

export interface Quiet { enabled: boolean; startHour: number; endHour: number }

export interface ExpectedVisit {
  id:          string
  icon:        string
  label:       string
  startsAt:    number
  endsAt:      number
  who?:        string
  passphrase?: string
  codeSecret?: string   // hex HMAC key for the live code; never sent to any client
  requestId?:  string   // VisitRequest that created this visit
  singleUse?:  boolean
  usedAt?:     number
  arrangedAt?: number   // when the visit was arranged; the start of the minimum-notice check
}

export interface RecurringVisit {
  id:             string
  icon:           string
  label:          string
  days:           number[]
  everyNWeeks:    number
  anchorWeek:     number
  startMin:       number
  endMin:         number
  alertIfMissed:  boolean
  paused:         boolean
  lastArrived?:   string
  lastMissedAlert?: string
  who?:           string
  passphrase?:    string
}

/** What a screen needs; the resident never gets the full schedule. */
export interface RecurringNow { id: string; icon: string; label: string; endsAt: number }

/** Section 8: extra case information for the screens (see getState). */
export interface LifecycleInfo {
  statements: { id: string; kind: 'expected' | 'known'; at: string; who: string; note?: string }[]
  disputed: { obsId: string; note?: string; at: string }[]
  prior: import('../doorstep/riskRules').PriorSeriousEvent[]
  notes: { id: string; label: string; disputed: boolean }[]
}

export interface DoorCase {
  id:            string
  kind:          CaseKind
  eventType:     string
  createdAt:     number
  helperIndex:   number
  deadlineAt:    number
  deadlineKind?: string   // household | approval | risk_decision | takeover
  timerDeadlines?: { [kind: string]: number }  // { approval?: ms, risk_decision?: ms, takeover?: ms }
  status:        CaseStatus
  answer?:       Answer
  answeredBy?:   string
  resolvedAt?:   number
  log:           { t: number; msg: string }[]
  visitor?:      Visitor
  confirmedAt?:  number
  declinedAt?:   number
  chain:         string[]
  deviceId?:     string | null
  ackedBy?:      string
  ackedAt?:      number
  lane?:         'normal' | 'expected'
  recurringId?:  string
  visitIcon?:    string
  visitLabel?:   string
  checkWho?:     string    // visitor identity shown on resident screen
  checkWord?:    string    // passphrase resident checks (only set when plannedMode='resident')
  checkMode?:    'word' | 'code'
  checkAttempts?: number
  checkCode?:    string    // resident snapshot only — live rotating code; never stored
  checkCodeEndsAt?: number // resident snapshot only — when the code changes next
  expectedId?:   string    // ExpectedVisit that matched (null for recurring or unplanned)
  selfVerifiedAt?: number  // set when resident confirms the passphrase
  noticeStatus?: NoticeStatus // minimum-notice result (spec section 3). Never a risk input.
  regularId?:    string    // RegularVisitor whose face the door camera matched (a hint for the helper, never permission)
  riskScore?:    number    // P11: Risk score for emergency detection
  controlMode?:  string    // P11: Control mode for emergency detection
  /** Spec 4.3: set when an uncertain forced_entry_or_assault was observed (camera description alone).
   *  Used by the resident view to show the keep-closed message before confirmation arrives. */
  unconfirmedAlertedAt?: number | null
  /** C-04: Whether a helper has accepted a request for this case (not just seen it). */
  helperAccepted?: boolean
  /** Section 8.1 lifecycle (open, helper_review, visitor_left, closed). `status` above is the doorbell answer flow. */
  lifecycle?:    LifecycleState
  visitorLeftAt?: number
  closedAt?:     number
  outcome?:      string
  possibleNewVisitorAt?: number
  splitFromId?:  string
  /** Section 7: Helper requests for this case (sent, delivered, acked, accepted, declined, timed_out) */
  helperRequests?: { id: string; kind: string; state: string; membershipId: string; sentAt: number; deliveredAt?: number; ackedAt?: number; acceptedAt?: number; declinedAt?: number; timedOutAt?: number; channels?: any }[]
  /** Section 7: Pending actions awaiting helper approval (pending, approved, rejected, consumed). `text` is the exact proposed words. */
  pendingActions?: { id: string; tool: string; state: string; text?: string; reason?: string; approver?: string; kind?: string; decidedBy?: string; createdAt: number }[]
  /** Section 7: membership that currently owns the conversation (the AI stays silent while set). Helper view only. */
  conversationOwner?: string | null
  /** Section 7.2: sanitized, recorded-only status for the resident screen. */
  residentStatus?: {
    requests: { id: string; kind: string; state: string; helperName?: string; label: string }[]
    ownerName: string | null
    residentApprovals: { id: string; text: string; kind: string }[]
  }
}

/** Match result from matchPlanned() */
interface PlannedMatch {
  id:          string
  icon:        string
  label:       string
  who?:        string
  passphrase?: string
  codeSecret?: string
  key:         string
  recurring?:  RecurringVisit  // set when the match came from a recurring schedule
}

export interface DeviceInfo { online: boolean; since: number; alertedAt?: number }

interface HouseholdState {
  householdId:    string
  timezone:       string
  plannedMode:    PlannedMode
  cases:          DoorCase[]
  offline:        boolean
  dbHealthy:      boolean
  timeoutSec:     number
  quiet:          Quiet
  expected:       ExpectedVisit[]
  recurring:      RecurringVisit[]
  checkinAt:      number | null
  missedAlertDay: string | null
  devices:        Record<string, DeviceInfo>
  lastTickAt:     number
  lastRequestSweepAt: number
  loaded:         boolean
}

// ── State map ─────────────────────────────────────────────────────────────────

const householdStates = new Map<string, HouseholdState>()
const loadingStates   = new Map<string, Promise<void>>()

async function getOrCreateState(householdId: string): Promise<HouseholdState> {
  if (householdStates.has(householdId)) return householdStates.get(householdId)!
  if (loadingStates.has(householdId)) {
    await loadingStates.get(householdId)!
    return householdStates.get(householdId)!
  }
  const p = loadStateFromDB(householdId)
  loadingStates.set(householdId, p)
  await p
  loadingStates.delete(householdId)
  return householdStates.get(householdId)!
}

async function loadStateFromDB(householdId: string): Promise<void> {
  try {
    const household = await getHousehold(householdId)
    if (!household) {
      console.error(`[STORE] Household not found: ${householdId}`)
      return
    }

    const dbCases = await getCasesForHousehold(householdId, 200)
    const cases: DoorCase[] = dbCases.map(c => ({
      id:            c.id,
      kind:          c.kind as CaseKind,
      eventType:     c.eventType,
      createdAt:     c.createdAt.getTime(),
      helperIndex:   c.helperIndex,
      deadlineAt:    c.deadlineAt.getTime(),
      deadlineKind:  (c as any).deadlineKind || undefined,
      timerDeadlines: (c as any).timerDeadlines || undefined,
      status:        c.status as CaseStatus,
      answer:        c.answer as Answer | undefined,
      answeredBy:    c.answeredBy || undefined,
      resolvedAt:    c.resolvedAt?.getTime(),
      log:           (c.log as any) || [],
      visitor:       c.visitor as Visitor | undefined,
      confirmedAt:   c.confirmedAt?.getTime(),
      declinedAt:    c.declinedAt?.getTime(),
      chain:         (c.chain as any) || [],
      deviceId:      c.deviceId,
      ackedBy:       c.ackedBy || undefined,
      ackedAt:       c.ackedAt?.getTime(),
      lane:          c.lane as 'normal' | 'expected' | undefined,
      recurringId:   c.recurringId || undefined,
      visitIcon:     c.visitIcon || undefined,
      visitLabel:    c.visitLabel || undefined,
      checkWho:      (c as any).checkWho   || undefined,
      checkWord:     (c as any).checkWord  || undefined,
      checkMode:     ((c as any).checkMode as any) || undefined,
      checkAttempts: (c as any).checkAttempts ?? 0,
      expectedId:    (c as any).expectedId    || undefined,
      selfVerifiedAt: (c as any).selfVerifiedAt ? new Date((c as any).selfVerifiedAt).getTime() : undefined,
      regularId:     (c as any).regularId     || undefined,
      noticeStatus:  ((c as any).noticeStatus as NoticeStatus) || undefined,
      riskScore:     (c as any).riskScore ?? undefined,
      lifecycle: ((c as any).lifecycle as LifecycleState) || 'open',
      visitorLeftAt: (c as any).visitorLeftAt ? new Date((c as any).visitorLeftAt).getTime() : undefined,
      closedAt: (c as any).closedAt ? new Date((c as any).closedAt).getTime() : undefined,
      outcome: (c as any).outcome || undefined,
      possibleNewVisitorAt: (c as any).possibleNewVisitorAt ? new Date((c as any).possibleNewVisitorAt).getTime() : undefined,
      splitFromId: (c as any).splitFromId || undefined,
      controlMode:   (c as any).controlMode || undefined,
      unconfirmedAlertedAt: (c as any).unconfirmedAlertedAt ? new Date((c as any).unconfirmedAlertedAt).getTime() : null,
      // C-04: helperAccepted is computed from HelperRequest state
      helperAccepted: ((c as any).helperRequests as any[])?.some((hr: any) => hr.state === 'accepted') ?? false,
      // Section 7: Include helper requests
      helperRequests: (c as any).helperRequests?.map((hr: any) => ({
        id: hr.id,
        kind: hr.kind,
        state: hr.state,
        membershipId: hr.membershipId,
        sentAt: hr.sentAt.getTime(),
      })) || [],
    }))

    const approved = await getApprovedMemberships(householdId)
    const known    = approved.map(m => m.id)
    const timeout  = household.timeoutSec || DEFAULT_ESCALATION_SECONDS
    const now = Date.now()
    for (const c of cases) {
      if (c.status === 'waiting') {
        // Reconcile the compatibility deadline with the independently stored timers on startup.
        // The timer map is authoritative: a stale, earlier deadlineAt must never expire a later timer early.
        let timerMap = normalizeTimerDeadlines(c.timerDeadlines)
        const explicitlyTimerless = c.deadlineKind === 'none' || c.deadlineKind === 'emergency'
        if (!explicitlyTimerless && Object.keys(timerMap).length === 0) {
          // Backward compatibility for a pre-migration row that has no timer map.
          const allowedKinds: TimerKind[] = ['household', 'approval', 'risk_decision', 'takeover']
          const kind: TimerKind = allowedKinds.includes(c.deadlineKind as TimerKind) ? c.deadlineKind as TimerKind : 'household'
          timerMap[kind as keyof TimerDeadlineMap] = c.deadlineAt
        }

        if (!explicitlyTimerless) {
          let governing = governingTimer(timerMap)
          if (governing && governing.deadlineMs <= now) {
            // Timers that elapsed while the server was down receive a single five-second restart grace.
            // Future timers are preserved, not shortened or reset merely because another field was stale.
            const graceAt = now + 5_000
            for (const [kind, deadlineMs] of Object.entries(timerMap)) {
              if (deadlineMs <= now) timerMap[kind as keyof TimerDeadlineMap] = graceAt
            }
            governing = governingTimer(timerMap)
            c.log.push({ t: now, msg: 'Server restarted. An expired timer received a five-second grace before escalation resumes.' })
          }

          if (governing && (c.deadlineAt !== governing.deadlineMs || c.deadlineKind !== governing.kind || JSON.stringify(normalizeTimerDeadlines(c.timerDeadlines)) !== JSON.stringify(timerMap))) {
            c.deadlineAt = governing.deadlineMs
            c.deadlineKind = governing.kind
            c.timerDeadlines = timerMap
            updateCase(c.id, { deadlineAt: c.deadlineAt, deadlineKind: c.deadlineKind, timerDeadlines: c.timerDeadlines, log: c.log }).catch(e => reportError(e, { householdId, fn: 'restart-timer-reconcile' }))
          } else if (governing) {
            c.deadlineAt = governing.deadlineMs
            c.deadlineKind = governing.kind
            c.timerDeadlines = timerMap
          }
        }
      }
      // Section 7: Build chain sorted by tier (primary, backup, third) then by position
      if (!c.chain.length) c.chain = chainFrom(await getApprovedMemberships(householdId))
    }

    const dbExpected  = await getExpectedVisitsForHousehold(householdId)
    const expected: ExpectedVisit[] = dbExpected.map(e => ({
      id:         e.id,
      icon:       e.icon,
      label:      e.label,
      startsAt:   e.startsAt.getTime(),
      endsAt:     e.endsAt.getTime(),
      who:        (e as any).who        || undefined,
      passphrase: (e as any).passphrase || undefined,
      codeSecret: (e as any).codeSecret || undefined,
      requestId:  (e as any).requestId  || undefined,
      singleUse:  !!(e as any).singleUse,
      usedAt:     (e as any).usedAt ? new Date((e as any).usedAt).getTime() : undefined,
      arrangedAt: (e as any).arrangedAt ? new Date((e as any).arrangedAt).getTime() : undefined,
    }))

    const dbRecurring = await getRecurringVisitsForHousehold(householdId)
    const recurring: RecurringVisit[] = dbRecurring.map(r => ({
      id:             r.id,
      icon:           r.icon,
      label:          r.label,
      days:           (r.days as any) || [],
      everyNWeeks:    r.everyNWeeks,
      anchorWeek:     r.anchorWeek,
      startMin:       r.startMin,
      endMin:         r.endMin,
      alertIfMissed:  r.alertIfMissed,
      paused:         r.paused,
      lastArrived:    r.lastArrived || undefined,
      lastMissedAlert: r.lastMissedAlert || undefined,
      who:            (r as any).who        || undefined,
      passphrase:     (r as any).passphrase || undefined,
    }))

    const dbDevices = await getDb().device.findMany({ where: { householdId } })
    const devices: Record<string, DeviceInfo> = {}
    for (const d of dbDevices) {
      devices[d.ringDeviceId] = { online: d.online, since: d.since.getTime(), alertedAt: d.alertedAt?.getTime() }
    }

    householdStates.set(householdId, {
      householdId,
      timezone:    household.timezone || 'UTC',
      plannedMode: asMode((household as any).plannedMode),
      cases,
      offline: false,
      dbHealthy: true,
      timeoutSec: household.timeoutSec || DEFAULT_ESCALATION_SECONDS,
      quiet: { enabled: household.quietEnabled, startHour: household.quietStartHour, endHour: household.quietEndHour },
      expected,
      recurring,
      checkinAt:      null,
      missedAlertDay: null,
      devices,
      lastTickAt: 0,
      lastRequestSweepAt: 0,
      loaded: true,
    })
    console.log(`[STORE] Loaded state for household ${householdId}`)
  } catch (e) {
    console.error(`[STORE] Failed to load state for household ${householdId}`, e)
    householdStates.set(householdId, {
      householdId,
      timezone:    'UTC',
      plannedMode: 'helper',
      cases: [],
      offline: false,
      dbHealthy: false,
      timeoutSec: DEFAULT_ESCALATION_SECONDS,
      quiet: { enabled: false, startHour: 22, endHour: 6 },
      expected: [],
      recurring: [],
      checkinAt:      null,
      missedAlertDay: null,
      devices: {},
      lastTickAt: 0,
      lastRequestSweepAt: 0,
      loaded: false,
    })
  }
}

// ── Refresh cases from database ───────────────────────────────────────────────
// Reusable function to reload cases from PostgreSQL and sync with in-memory state.
// This ensures that events created by webhooks or other server instances are visible.

/** Spec 5.3: another module shortened the database deadline, so move the cached copy earlier too (never later). */
export function syncCaseDeadline(householdId: string, caseId: string, deadlineMs: number): void {
  const state = householdStates.get(householdId)
  const c = state?.cases.find((x) => x.id === caseId)
  if (c && deadlineMs < c.deadlineAt) c.deadlineAt = deadlineMs
}

async function refreshCasesFromDB(
  householdId: string,
  state: HouseholdState
) {
  const rows = await getCasesForHousehold(householdId, 10);

  state.cases = rows.map((row) => ({
    id: row.id,
    kind: row.kind as CaseKind,
    eventType: row.eventType,
    createdAt: row.createdAt.getTime(),
    helperIndex: row.helperIndex,
    deadlineAt: row.deadlineAt.getTime(),
    deadlineKind: (row as any).deadlineKind || undefined,
    timerDeadlines: (row as any).timerDeadlines || undefined,
    status: row.status as CaseStatus,
    answer: row.answer as Answer | undefined,
    answeredBy: row.answeredBy || undefined,
    resolvedAt: row.resolvedAt?.getTime(),
    log: (row.log as any) || [],
    visitor: row.visitor as Visitor | undefined,
    confirmedAt: row.confirmedAt?.getTime(),
    declinedAt: row.declinedAt?.getTime(),
    chain: (row.chain as any) || [],
    deviceId: row.deviceId,
    ackedBy: row.ackedBy || undefined,
    ackedAt: row.ackedAt?.getTime(),
    lane: row.lane as 'normal' | 'expected' | undefined,
    recurringId: row.recurringId || undefined,
    visitIcon: row.visitIcon || undefined,
    visitLabel: row.visitLabel || undefined,
    checkWho: (row as any).checkWho || undefined,
    checkWord: (row as any).checkWord || undefined,
    checkMode: (row as any).checkMode || undefined,
    checkAttempts: (row as any).checkAttempts ?? 0,
    expectedId: (row as any).expectedId || undefined,
    selfVerifiedAt: (row as any).selfVerifiedAt
      ? new Date((row as any).selfVerifiedAt).getTime()
      : undefined,
    regularId: (row as any).regularId || undefined,
    noticeStatus: ((row as any).noticeStatus as NoticeStatus) || undefined,
    riskScore: row.riskScore, // P11: Include for emergency detection
    lifecycle: ((row as any).lifecycle as LifecycleState) || 'open',
    visitorLeftAt: (row as any).visitorLeftAt ? new Date((row as any).visitorLeftAt).getTime() : undefined,
    closedAt: (row as any).closedAt ? new Date((row as any).closedAt).getTime() : undefined,
    outcome: (row as any).outcome || undefined,
    possibleNewVisitorAt: (row as any).possibleNewVisitorAt ? new Date((row as any).possibleNewVisitorAt).getTime() : undefined,
    splitFromId: (row as any).splitFromId || undefined,
    controlMode: row.controlMode, // P11: Include for emergency detection
    unconfirmedAlertedAt: (row as any).unconfirmedAlertedAt ? new Date((row as any).unconfirmedAlertedAt).getTime() : null,
    // Section 7: Include helper requests
    helperRequests: (row as any).helperRequests?.map((hr: any) => ({
      id: hr.id,
      kind: hr.kind,
      state: hr.state,
      membershipId: hr.membershipId,
      sentAt: hr.sentAt.getTime(),
    })) || [],
    // Section 7: Include pending actions from DB
    pendingActions: (Array.isArray((row as any).pendingActions) ? (row as any).pendingActions : []).map((pa: any) => ({
      id: pa.id,
      tool: pa.tool,
      text: pa.text,
      reason: pa.reason,
      approver: pa.approver ?? 'helper',
      kind: pa.kind ?? 'ai_action',
      state: pa.state,
      decidedBy: pa.decidedBy,
      createdAt: typeof pa.createdAt === 'number' ? pa.createdAt : new Date(pa.createdAt).getTime(),
    })),
    conversationOwner: (row as any).conversationOwner ?? null,
  }));
}

// ── State persistence ─────────────────────────────────────────────────────────
// Only cases and household settings are persisted on every save.
// Visits are written once (on add) and never re-created here.

async function saveState(householdId: string, state: HouseholdState) {
  if (!state.loaded) return
  try {
    for (const c of state.cases) { await updateCase(c.id, c) }

    await updateHousehold(householdId, {
      timeoutSec:     state.timeoutSec,
      quietEnabled:   state.quiet.enabled,
      quietStartHour: state.quiet.startHour,
      quietEndHour:   state.quiet.endHour,
    })

    // Devices
    for (const [ringDeviceId, info] of Object.entries(state.devices)) {
      await getDb().device.upsert({
        where:  { householdId_ringDeviceId: { householdId, ringDeviceId } },
        update: { online: info.online, since: new Date(info.since), alertedAt: info.alertedAt ? new Date(info.alertedAt) : null },
        create: { householdId, ringDeviceId, online: info.online, since: new Date(info.since), alertedAt: info.alertedAt ? new Date(info.alertedAt) : null },
      })
    }
  } catch (e) {
    reportError(e, { householdId, fn: 'saveState' })
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TRIGGER_EVENTS = new Set(
  (process.env.RING_TRIGGER_EVENTS || 'button_press').split(',').map(s => s.trim()).filter(Boolean)
)

const newId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
const clean = <T>(v: T | null | undefined): T | undefined => v == null ? undefined : v

function isQuiet(state: HouseholdState, now: number): boolean {
  const q = state.quiet
  if (!q.enabled || q.startHour === q.endHour) return false
  const h = zonedHour(now, state.timezone)
  return q.startHour < q.endHour ? h >= q.startHour && h < q.endHour : h >= q.startHour || h < q.endHour
}

const GRACE_MS = RECURRING_GRACE_MIN * 60_000

function windowToday(v: RecurringVisit, now: number, timezone: string) {
  if (v.paused) return null
  if (!v.days.includes(zonedWeekday(now, timezone))) return null
  const day  = zonedDayNumber(now, timezone)
  const week = Math.floor((day - v.anchorWeek) / 7)
  if (week < 0 || week % v.everyNWeeks !== 0) return null
  return {
    start: zonedMinuteOnSameDay(now, timezone, v.startMin),
    end:   zonedMinuteOnSameDay(now, timezone, v.endMin),
    key:   `${v.id}:${day}`,
  }
}

/**
 * Find a planned-visit match for a doorbell ring at `now`.
 * Returns null when plannedMode is 'all-helper' (every ring goes to a helper).
 */
function matchPlanned(
  state:    HouseholdState,
  now:      number,
  timezone: string,
  forceId?: string | null
): PlannedMatch | null {
  if (state.plannedMode === 'all-helper') return null

  // 1. Recurring visits
  for (const v of state.recurring) {
    if (forceId) {
      if (v.id === forceId) return { id: v.id, icon: v.icon, label: v.label, who: v.who, passphrase: v.passphrase, key: `${v.id}:forced:${now}`, recurring: v }
      continue
    }
    const w = windowToday(v, now, timezone)
    if (w && now >= w.start - GRACE_MS && now < w.end + GRACE_MS) {
      return { id: v.id, icon: v.icon, label: v.label, who: v.who, passphrase: v.passphrase, key: w.key, recurring: v }
    }
  }

  // 2. One-off expected visits
  if (!forceId) {
    for (const e of state.expected) {
      if (e.singleUse && e.usedAt) continue
      if (now >= e.startsAt - GRACE_MS && now < e.endsAt + GRACE_MS) {
        return { id: e.id, icon: e.icon, label: e.label, who: e.who, passphrase: e.passphrase, codeSecret: e.codeSecret, key: `${e.id}:once` }
      }
    }
  }

  return null
}

/** G1: Alert all helpers for a confirmed emergency, exactly once */
export async function alertEmergency(householdId: string, caseId: string): Promise<boolean> {
  const db = getDb()
  const now = Date.now()
  // Disable all acknowledgement timers before attempting the exactly-once alert claim. Doing this
  // as a separate idempotent update ensures even a case whose emergency was already alerted cannot
  // retain a stale approval/risk/takeover deadline.
  await db.case.updateMany({
    where: { id: caseId, status: 'waiting', closedAt: null },
    data: {
      deadlineAt: new Date(now + NO_ACTIVE_TIMER_SENTINEL_MS),
      deadlineKind: 'emergency',
      timerDeadlines: {},
    },
  })

  // Claim: only one caller, on any server, gets count === 1.
  const claim = await db.case.updateMany({
    where: { id: caseId, emergencyAlertedAt: null },
    data: { emergencyAlertedAt: new Date(now) },
  })
  if (claim.count !== 1) return false

  const state = await getOrCreateState(householdId)
  await refreshCasesFromDB(householdId, state)
  const c = state.cases.find(x => x.id === caseId)
  if (!c) return false

  const household = await getHousehold(householdId)
  const name = household?.residentName ?? 'The resident'
  const smsBody = `EMERGENCY at ${name}'s door: possible threat or forced entry. Do not open the door. Check the app now.`
  notifyAll(state, '🆘 EMERGENCY at the door', 'Do not open. Keep the door closed and move away.', c.id, { push: true, sms: true })
  // N-04: Removed duplicate smsAll call - notifyAll now handles both channels
  addLog(c, 'Emergency: all helpers alerted at once by push and SMS. Resident told to keep the door closed and move away.')
  await updateCase(c.id, c)
  return true
}

/** G4: Alert all helpers for an unconfirmed emergency (camera-only threat), exactly once */
export async function alertUnconfirmedEmergency(householdId: string, caseId: string): Promise<boolean> {
  const db = getDb()
  // Claim: only one caller, on any server, gets count === 1.
  const claim = await db.case.updateMany({
    where: { id: caseId, unconfirmedAlertedAt: null },
    data: { unconfirmedAlertedAt: new Date() },
  })
  if (claim.count !== 1) return false

  const state = await getOrCreateState(householdId)
  await refreshCasesFromDB(householdId, state)
  const c = state.cases.find(x => x.id === caseId)
  if (!c) return false

  const household = await getHousehold(householdId)
  const name = household?.residentName ?? 'The resident'
  const smsBody = `Possible emergency at ${name}'s door (not confirmed). Check the clip now.`
  notifyAll(state, 'Possible emergency at the door (not confirmed)', 'Check the clip now.', c.id, { push: true, sms: true })
  // N-04: Removed duplicate smsAll call - notifyAll now handles both channels
  addLog(c, 'Unconfirmed emergency: model reports possible forced entry. Helpers alerted. Score unchanged until confirmed.')
  await updateCase(c.id, c)
  return true
}

/**
 * Spec 4.4 rule 5 — confirmed immediate_threat skips the helper-acknowledgement timer.
 * P8: Also fires when S_eff is 80 to 99 (M4 mode).
 * Alerts every helper at once, exactly once, using an urgentAlertedAt claim.
 * Does NOT trigger the full emergency workflow — that is reserved for forced_entry_or_assault and SOS.
 * @param cause - 'threat' for confirmed immediate_threat, 'score' for S_eff 80-99
 */
export async function alertUrgent(householdId: string, caseId: string, cause: 'threat' | 'score' = 'threat'): Promise<boolean> {
  const db = getDb()
  const claim = await db.case.updateMany({
    where: { id: caseId, urgentAlertedAt: null },
    data:  { urgentAlertedAt: new Date() },
  })
  if (claim.count !== 1) return false

  const state = await getOrCreateState(householdId)
  await refreshCasesFromDB(householdId, state)
  const c = state.cases.find(x => x.id === caseId)
  if (!c) return false

  const household = await getHousehold(householdId)
  const name = household?.residentName ?? 'The resident'
  const isScoreBased = cause === 'score'

  if (isScoreBased) {
    // P8: Generic urgent alert for S_eff 80-99 (not a specific threat)
    const smsBody = `URGENT: high risk score at ${name}'s door. Check the app immediately.`
    notifyAll(state, '⚠️ Urgent situation at the door', 'Risk score is high. All helpers alerted. Please check the case.', c.id, { push: true, sms: true })
    // N-04: Removed duplicate smsAll call - notifyAll now handles both channels
    addLog(c, 'Urgent: S_eff in 80-99 range (M4 mode) — all helpers alerted at once.')
  } else {
    // Original threat-based alert
    const smsBody = `URGENT: threat reported at ${name}'s door. Check the app immediately.`
    notifyAll(state, '⚠️ Threat at the door — urgent', 'A credible threat has been made. All helpers alerted. Resident has been told to stay back.', c.id, { push: true, sms: true })
    // N-04: Removed duplicate smsAll call - notifyAll now handles both channels
    addLog(c, 'Urgent: confirmed immediate threat — all helpers alerted at once. Helper-acknowledgement timer bypassed (spec 4.4 rule 5).')
  }
  await updateCase(c.id, c)
  return true
}

function nextOccurrence(v: RecurringVisit, now: number, timezone: string): number | null {
  for (let i = 0; i <= 7 * v.everyNWeeks; i++) {
    const w = windowToday(v, now + i * 86_400_000, timezone)
    if (w && w.end > now) return w.start
  }
  return null
}

function checkMissedVisits(state: HouseholdState, now: number, timezone: string, residentName: string) {
  for (const v of state.recurring) {
    if (!v.alertIfMissed) continue
    const w = windowToday(v, now, timezone)
    if (!w || now < w.end + GRACE_MS) continue
    if (v.lastArrived === w.key || v.lastMissedAlert === w.key) continue
    v.lastMissedAlert = w.key
    updateRecurringVisit(v.id, { lastMissedAlert: w.key }).catch(() => {})
    notifyAll(state, `${v.icon} ${v.label} did not come`, `Expected today and nobody rang. Maybe call ${residentName}.`, `missed-${w.key}`)
    smsAll(state, `${v.icon} ${v.label} was expected today and nobody rang. Maybe call ${residentName}.`, residentName)
  }
}

/** Today's planned visits for the resident idle screen — no passphrases. */
function todayVisits(state: HouseholdState, now: number, timezone: string) {
  if (state.plannedMode === 'all-helper') return []
  const today   = zonedDayKey(now, timezone)
  const results: { id: string; icon: string; label: string; startsAt: number; endsAt: number; done: boolean }[] = []

  for (const v of state.recurring) {
    if (v.paused) continue
    const w = windowToday(v, now, timezone)
    if (!w) continue
    results.push({ id: v.id, icon: v.icon, label: v.label, startsAt: w.start, endsAt: w.end, done: v.lastArrived === w.key })
  }
  for (const e of state.expected) {
    // Only show visits whose window falls on today (not future dates)
    if (zonedDayKey(e.startsAt, timezone) !== today) continue
    // Mark as done if the window has fully closed (no open case needed: resident saw them)
    const done = now >= e.endsAt
    results.push({ id: e.id, icon: e.icon, label: e.label, startsAt: e.startsAt, endsAt: e.endsAt, done })
  }
  return results.sort((a, b) => a.startsAt - b.startsAt)
}

const dayKey      = (ms: number, tz: string) => zonedDayKey(ms, tz)
const dueAt       = (now: number, tz: string) => zonedHourOnSameDay(now, tz, CHECKIN_HOUR)
const checkedInToday = (state: HouseholdState, now: number, tz: string) =>
  state.checkinAt !== null && dayKey(state.checkinAt, tz) === dayKey(now, tz)

function checkMissedCheckin(state: HouseholdState, now: number, timezone: string, residentName: string) {
  const key  = dayKey(now, timezone)
  const late = now >= dueAt(now, timezone) + CHECKIN_GRACE_MIN * 60_000
  if (!late || checkedInToday(state, now, timezone) || state.missedAlertDay === key) return
  state.missedAlertDay = key
  notifyAll(state, '⚠️ No check-in today', `${residentName} has not pressed "I'm OK" yet. Please call.`, `checkin-${key}`)
  smsAll(state, `${residentName} has not checked in today. Please call.`, residentName)
}

async function notifyAll(state: HouseholdState, title: string, body: string, caseId: string, channels?: { push?: boolean; sms?: boolean }) {
  const memberships = await getApprovedMemberships(state.householdId)
  const pushPayload = { title, body, tag: caseId, url: '/helper' }
  await Promise.all(
    memberships.map(m => {
      const payload: { push?: typeof pushPayload; sms?: string } = {}
      if (channels?.push !== false) payload.push = pushPayload
      if (channels?.sms !== false) payload.sms = body
      if (Object.keys(payload).length > 0) {
        return contactHelper(caseId, m.id, payload)
      }
    })
  )
}

async function smsAll(state: Pick<HouseholdState, 'householdId'>, body: string, residentName: string, urgent = true, caseId?: string) {
  const memberships = await getApprovedMemberships(state.householdId)
  const realCaseId = caseId || 'system'
  await Promise.all(
    memberships.map(m =>
      contactHelper(realCaseId, m.id, { push: { title: residentName, body }, sms: body })
    )
  )
}


const addLog = (c: DoorCase, msg: string) => { c.log.push({ t: Date.now(), msg }) }

// ── Public read functions ─────────────────────────────────────────────────────

export async function getState(householdId: string, view: 'resident' | 'helper' = 'helper', membershipId?: string) {
  const state     = await getOrCreateState(householdId)
  const household = await getHousehold(householdId)
  if (!household) return null

  // Read recently persisted cases so this process sees events
  // created by a webhook or another server instance.
  await refreshCasesFromDB(householdId, state);

  await tick(householdId)
  const now      = Date.now()
  const resident = view === 'resident'
  const cur      = activeCase(state, now)
  const tz       = household.timezone

  const memberships = await getApprovedMemberships(householdId)
  type MemberRow = { id: string; emoji: string; user: { name: string | null; phone: string | null } }
  const pub = (m: MemberRow, withPhone: boolean) => ({
    id: m.id, name: m.user.name, emoji: m.emoji,
    ...(withPhone ? { phone: m.user.phone } : {})
  })

  // For resident view: strip checkWho/checkWord/checkMode unless it is an expected waiting case
  const currentForResident = cur ? (() => {
    const base: DoorCase = { ...cur, log: [] }
    const showCheck = cur.lane === 'expected' && cur.status === 'waiting' && hasCheck(cur)
    if (!showCheck) {
      delete base.checkWho; delete base.checkWord; delete base.checkMode; delete base.checkAttempts
    } else if (cur.checkMode === 'code') {
      // Inject the live code into the resident snapshot (never stored, never sent elsewhere)
      const e = state.expected.find(x => x.id === cur.expectedId)
      if (e?.codeSecret) {
        const w = currentCode(e.codeSecret, now)
        base.checkCode       = w.code
        base.checkCodeEndsAt = w.endsAt
      }
    }
    // Section 7.2: the resident sees only what has really been recorded, never channels, tools or other helpers' details.
    const names = new Map<string, string | undefined>(memberships.map((m: any) => [m.id as string, (m.user?.name ?? undefined) as string | undefined]))
    base.residentStatus = {
      requests: residentRequestSummary(cur.helperRequests ?? [], (id) => names.get(id)),
      ownerName: cur.conversationOwner ? (names.get(cur.conversationOwner) ?? 'A helper') : null,
      residentApprovals: (cur.pendingActions ?? [])
        .filter((a) => a.state === 'pending' && a.approver === 'resident')
        .map((a) => ({ id: a.id, text: a.text ?? a.tool, kind: a.kind ?? 'ai_action' })),
    }
    delete base.helperRequests
    delete base.pendingActions
    delete base.conversationOwner
    return base
  })() : null

  // Section 8: what the screens need to show beyond the case row.
  //  helper:   resident statements, observations the resident disputed, and earlier serious events (information only)
  //  resident: what was noted (so a wrong one can be flagged for the helper); the resident can flag, never retract
  let lifecycleInfo: LifecycleInfo | null = null
  if (cur) {
    try {
      const row = await getCase(cur.id)
      const st = readStored((row as any)?.riskObservations)
      const live = st.observations.filter(o => o.id && !o.retracted && o.source !== 'resident')
      if (resident) {
        lifecycleInfo = { statements: st.statements ?? [], disputed: [], prior: [], notes: live.map(o => ({ id: o.id!, label: RISK_RULES[o.code]?.label ?? o.code, disputed: !!o.disputedAt })) }
      } else {
        lifecycleInfo = {
          statements: st.statements ?? [],
          disputed: st.observations.filter(o => o.disputedAt && !o.retracted).map(o => ({ obsId: o.id!, note: o.disputeNote, at: o.disputedAt! })),
          prior: await getPriorSeriousEvents(householdId, cur.id),
          notes: [],
        }
      }
    } catch (e) {
      reportError(e, { householdId, fn: 'getState/lifecycleInfo' })
    }
  }

  return {
    now,
    lifecycleInfo,
    me:     membershipId ?? null,
    ready:  memberships.length > 0,
    emergencyNumber: household.emergencyNumber,
    timeoutSec:  state.timeoutSec,
    offline:     state.offline || anyDeviceOffline(state),
    dbHealthy:   state.dbHealthy,
    helpers:     memberships.map(m => pub(m, resident)),
    current:     resident ? currentForResident : cur,
    history:     resident ? [] : state.cases.slice(0, 10),
    expected:    state.expected.filter(e => e.endsAt > now).map(e => ({ ...e, passphrase: undefined, codeSecret: undefined })),
    expectedNow: state.expected
      .filter(e => e.startsAt <= now && now < e.endsAt)
      .map(e => ({ id: e.id, icon: e.icon, label: e.label, startsAt: e.startsAt, endsAt: e.endsAt })),
    timeZone:    tz,
    plannedMode: state.plannedMode,
    todayVisits: resident ? todayVisits(state, now, tz) : [],
    recurring: resident ? [] : state.recurring.map(v => ({ ...v, next: nextOccurrence(v, now, tz) })),
    recurringNow: state.recurring.flatMap(v => {
      const w = windowToday(v, now, tz)
      return w && now >= w.start - GRACE_MS && now < w.end + GRACE_MS
        ? [{ id: v.id, icon: v.icon, label: v.label, endsAt: w.end }]
        : []
    }),
    checkin:   { doneToday: checkedInToday(state, now, tz), dueHour: CHECKIN_HOUR },
    quietNow:  isQuiet(state, now),
    alerts:    resident ? null : alertStatus(now),
    devices:   state.devices,
  }
}

export async function getHistory(householdId: string) {
  const state       = await getOrCreateState(householdId)
  const memberships = await getApprovedMemberships(householdId)
  return {
    helpers: memberships.map(m => ({ id: m.id, name: m.user.name, emoji: m.emoji })),
    cases:   state.cases
  }
}

export async function getSetup(householdId: string) {
  const state     = await getOrCreateState(householdId)
  const household = await getHousehold(householdId)
  if (!household) return null

  const memberships = await dbGetMembershipsForHousehold(householdId)
  const now = Date.now()

  return {
    members: memberships.map(m => ({
      id: m.id, name: m.user.name, phone: m.user.phone, emoji: m.emoji, consent: m.consent, role: m.role,
      user: { id: m.user.id, name: m.user.name },
    })),
    quiet:       state.quiet,
    timeoutSec:  state.timeoutSec,
    ready:       memberships.some(m => m.consent === 'approved'),
    timeZone:    household.timezone,
    plannedMode: state.plannedMode,
    expected:    state.expected.map(e => ({ ...e, codeSecret: undefined })),
    recurring:   state.recurring.map(v => ({ ...v, next: nextOccurrence(v, now, household.timezone) })),
  }
}

// ── Case lifecycle ────────────────────────────────────────────────────────────

function activeCase(state: HouseholdState, now = Date.now()): DoorCase | null {
  const c = state.cases.find(x => x.lifecycle !== 'closed')
  if (!c) return null
  if (c.status === 'waiting') return c
  const awaitingConfirm = c.status === 'answered' && c.answer === 'safe' && !c.confirmedAt && !c.declinedAt
  const age = now - (c.resolvedAt ?? c.createdAt)
  const ttl = c.status === 'no_response' || awaitingConfirm ? NO_RESPONSE_TTL_MS : RESULT_TTL_MS
  return age < ttl ? c : null
}

async function openCase(
  state:            HouseholdState,
  kind:             CaseKind,
  eventType:        string,
  note:             string,
  deviceId:         string | null = null,
  forceRecurringId: string | null = null
): Promise<DoorCase> {
  const household = await getHousehold(state.householdId)
  if (!household) throw new Error('Household not found')

  const now      = Date.now()
  const m        = kind === 'visitor' ? matchPlanned(state, now, household.timezone, forceRecurringId) : null
  const hasSecret     = !!m?.codeSecret
  const residentCheck = !!m && state.plannedMode === 'resident' && (!!m.passphrase || hasSecret)
  let secs       = m ? EXPECTED_TIMEOUT_SECONDS : state.timeoutSec
  const approved = await getApprovedMemberships(state.householdId)

  const c: DoorCase = {
    id:          newId('case'),
    kind,
    eventType,
    createdAt:   now,
    helperIndex: 0,
    deadlineAt:  now + secs * 1000,
    deadlineKind: m ? 'household' : 'household', // Section 5.3: initial deadline is household timeout
    timerDeadlines: {},
    status:      'waiting',
    log:         [],
    chain:       approved.map(m => m.id), // Will be re-sorted by tier below
    deviceId,
    lane:        m ? 'expected' : 'normal',
    recurringId: m?.recurring?.id,
    visitIcon:   m?.icon,
    visitLabel:  m?.label,
    checkWho:    m ? (m.who || m.label) : undefined,
    checkMode:   residentCheck ? (hasSecret ? 'code' : 'word') : undefined,
    checkAttempts: 0,
    checkWord:   residentCheck && !hasSecret ? m!.passphrase : undefined,
    expectedId:  m && !m.recurring ? m.id : undefined,
  }

  // Section 7: Sort chain by tier (primary, backup, third) then by position
  c.chain = chainFrom(await getApprovedMemberships(state.householdId))

  // Minimum-notice policy. Separate from risk: it can require approval, it never adds points.
  const planned = m && !m.recurring ? state.expected.find(x => x.id === m.id) : undefined
  const notice = evaluateNotice(
    { arrangedAt: planned?.arrangedAt, visitStartsAt: planned?.startsAt, standing: !!m?.recurring },
    parseNoticeSettings(household),
  )
  c.noticeStatus = notice.status
  // Spec 5.3 approval timer: a rule that needs helper approval uses the resident's timer, at any score (even 0).
  if (notice.requiresApproval && notice.status === 'short_notice') {
    secs = parseNoticeSettings(household).approvalTimerSec
    c.deadlineAt = now + secs * 1000
    c.deadlineKind = 'approval'
    c.timerDeadlines = { approval: c.deadlineAt }
    // Record the approval timer independently using the deadline helper
    const { recordTimerDeadline } = await import('@/lib/doorstep/deadline')
    await recordTimerDeadline(state.householdId, c.id, 'approval', c.deadlineAt, 'Short-notice visit requires approval')
  }

  // Section 7: Store approval retry interval for later use
  ;(c as any).approvalRetrySec = parseNoticeSettings(household).approvalRetrySec

  addLog(c, note)
  if (notice.status === 'short_notice') addLog(c, notice.reason)

  if (m) {
    if (m.recurring) {
      // Persist lastArrived on the recurring rule
      m.recurring.lastArrived = m.key
      updateRecurringVisit(m.recurring.id, { lastArrived: m.key }).catch((e) => console.error('[STORE] could not save arrival mark', e))
    }
    if (residentCheck) {
      addLog(c, `Planned visit: ${m.icon} ${m.label}. Resident will verify the pass-word first.`)
    } else {
      addLog(c, `Planned visit: ${m.icon} ${m.label}. Quiet alert, helper confirms.`)
    }
  }

  if (!approved.length) addLog(c, 'NO APPROVED HELPERS. Nobody can be alerted. Finish setup.')
  addLog(c, `Asked ${approved[0]?.user.name ?? 'a helper'}. ${secs}s to answer.`)

  if (kind === 'visitor' && approved[0]) {
    if (m && !residentCheck) {
      pushToMembership(approved[0].id, { title: `${m.icon} ${m.label} may be at the door`, body: 'Open the app and confirm. One tap.', tag: c.id, url: '/helper' })
    } else if (m && residentCheck) {
      pushToMembership(approved[0].id, { title: `${m.icon} ${m.label} may be here`, body: `Resident is checking${hasSecret ? ' a number' : ' a pass-word'}. You will be notified.`, tag: c.id, url: '/helper' })
    } else {
      pushToMembership(approved[0].id, { title: '🚪 Someone is at the door', body: `Open the app. You have ${state.timeoutSec}s.`, tag: c.id, url: '/helper' })
      if (approved[0].user.phone) {
        sendSms(approved[0].user.phone, `Someone is at ${household.residentName}'s door. Open the helper app now. You have ${state.timeoutSec}s.`, { urgent: true })
      }
    }
  }

  state.cases.unshift(c)
  if (state.cases.length > 200) state.cases.pop()
  await createCase({ ...c, householdId: state.householdId })

  // Spec 7.2 step 4: a short-notice visit that needs approval gets a recorded approval request, so the helper (or the
  // resident) has a real item to approve and the hold lifts only when it is approved. Silence never approves.
  if (notice.status === 'short_notice' && notice.requiresApproval) {
    try {
      const { createPendingAction } = await import('../doorstep/pendingActions')
      const label = c.visitLabel ? `${c.visitLabel}` : 'a visitor'
      const created = await createPendingAction(c.id, 'visit_approval', `Let ${label} in? This visit was arranged on short notice.`, 'short_notice', { approver: notice.approver === 'resident' ? 'resident' : 'helper', kind: 'visit_approval' })
      if (created) {
        const { notifyPendingAction } = await import('../doorstep/approvalNotify')
        await notifyPendingAction({ householdId: state.householdId, caseId: c.id, action: created }).catch((e) => console.error('[STORE] approval notify failed', e))
      }
    } catch (e) { console.error('[STORE] visit approval record failed', e) }
  }

  // Spec 4.3: if the camera is already offline when the case opens, mark it unavailable immediately.
  if (anyDeviceOffline(state)) {
    const offlineSince = Math.min(...Object.values(state.devices).filter(d => !d.online).map(d => d.since))
    applyRiskEdit(c.id, {
      kind: 'availability', device: 'camera', available: false,
      since: new Date(offlineSince).toISOString(), reason: 'Doorbell was offline when this case was opened',
    }).catch(e => console.error('[STORE] openCase availability mark failed', e))
  }

  // G1d: SOS uses the same alert function (call before risk write so alert goes out even if scoring fails)
  if (kind === 'sos') await alertEmergency(state.householdId, c.id)
  return c
}

export async function ingestEvent(householdId: string, event: { event_type: string; event_id?: string; device_id?: string | null; raw?: any }): Promise<DoorCase | null> {
  const state = await getOrCreateState(householdId)
  if (state.offline) return null
  if (!TRIGGER_EVENTS.has(event.event_type)) return null

  await tick(householdId)

  // Section 8.2: a new event attaches to the newest case that is not closed, because the system cannot reliably tell
  // visitors apart. Only a closed case lets the event open a new case (starting at 0, nothing carried over).
  const active = await getActiveLifecycleCase(householdId)
  if (active) {
    const existing = state.cases.find(c => c.id === active.id)
    // P9: Count repeated button_press events as extra_knock within 30s window
    if (event.event_type === 'button_press') {
      await handleExtraKnock(householdId, active.id, event.device_id)
    }
    const attached = await attachEvent(active.id)
    if (existing) {
      addLog(existing, `Another ${event.event_type} event merged into this case (no second alert).`)
      if (attached.ok && attached.possibleNewVisitor) addLog(existing, 'Possible new visitor: this event came after the earlier visit was dealt with. A helper can split it into a new case.')
      await updateCase(existing.id, existing)
    }
    return null  // Return null to indicate the event was merged into an existing case
  }

  const c = await openCase(state, 'visitor', event.event_type, `Ring sent ${event.event_type}.`, event.device_id ?? null, null)
  void import('@/face/camera').then((m) => m.onCameraEvent(householdId, { caseId: c.id, deviceId: event.device_id ?? null })).catch(() => {})
  // AI is advisory: fire-and-forget, never awaited, never on the alert path.
  void import('@/lib/ai/hooks').then((m) => m.onDoorEvent(householdId, { caseId: c.id, deviceId: event.device_id ?? null, kind: c.kind || '', lane: c.lane || null, expectedId: c.expectedId || null, recurringId: c.recurringId || null })).catch(() => {})
  return c
}

/**
 * Open a case for a high-severity sensor event (door_force, tamper, lock_tamper, door_wedge).
 * This bypasses the TRIGGER_EVENTS filter and creates a case even when no button press occurred.
 * N-02: Fixes sensor events being dropped when no open case exists.
 */
export async function openSensorCase(householdId: string, deviceId: string | null, type: 'door_force' | 'tamper' | 'lock_tamper' | 'door_wedge'): Promise<DoorCase | null> {
  const state = await getOrCreateState(householdId)
  if (state.offline) return null

  await tick(householdId)

  // Check if there's already an active case
  const active = await getActiveLifecycleCase(householdId)
  if (active) {
    return active  // Return existing case instead of opening a new one
  }

  const description = type === 'door_force' ? 'Sensor: door force detected' :
                      type === 'tamper' ? 'Sensor: tamper detected' :
                      type === 'lock_tamper' ? 'Sensor: lock tamper detected' :
                      'Sensor: door wedge detected'

  const c = await openCase(state, 'visitor', type, description, deviceId, null)
  void import('@/face/camera').then((m) => m.onCameraEvent(householdId, { caseId: c.id, deviceId })).catch(() => {})
  void import('@/lib/ai/hooks').then((m) => m.onDoorEvent(householdId, { caseId: c.id, deviceId, kind: c.kind || '', lane: c.lane || null, expectedId: c.expectedId || null, recurringId: c.recurringId || null })).catch(() => {})
  return c
}

/**
 * G2: Handle repeated button_press events as extra_knock observations through applyRiskEdit.
 * Counts presses within 30 seconds of the AI's "responding" stamp.
 */
async function handleExtraKnock(householdId: string, caseId: string, _deviceId: string | null) {
  try {
    // applyRiskEdit already enforces the 30-second window and the cap of 5, then re-scores.
    await applyRiskEdit(caseId, { kind: 'knock', at: new Date().toISOString() })
  } catch (e) {
    console.error('[G2] Failed to handle extra_knock:', e)
  }
}

/**
 * Section 8.2: open the new case for a split "possible new visitor". Goes through openCase, so the normal alert path
 * runs (the first helper is notified) and the new case starts at 0 with a fresh answer timer.
 */
export async function openSplitCase(householdId: string, from: { id: string; eventType: string; deviceId: string | null }): Promise<DoorCase> {
  const state = await getOrCreateState(householdId)
  return openCase(state, 'visitor', from.eventType, `Split from case ${from.id}: a possible new visitor.`, from.deviceId, null)
}

/**
 * The door camera recognised an approved regular visitor. Tag the open case so the helper sees who it probably is.
 * This changes what the helper SEES. It does not answer the case, skip the helper, or open anything.
 */
export async function noteRegularVisitor(
  householdId: string,
  caseId: string,
  r: { id: string; name: string; icon: string; strength: 'strong' | 'ok' }
): Promise<DoorCase | null> {
  const state = await getOrCreateState(householdId)
  const c = state.cases.find(x => x.id === caseId)
  if (!c || c.kind !== 'visitor' || c.regularId || c.status !== 'waiting') return null
  c.regularId  = r.id
  if (c.lane !== 'expected') { c.visitIcon = r.icon; c.visitLabel = r.name }
  addLog(c, `Door camera: looks like regular visitor ${r.name} (${r.strength} match). The helper still decides.`)
  await updateCase(c.id, c)
  return c
}

export async function raiseSos(householdId: string): Promise<DoorCase> {
  const state = await getOrCreateState(householdId)
  await tick(householdId)
  const existing = activeCase(state)
  if (existing && existing.status === 'waiting') {
    if (existing.kind === 'sos') return existing
    existing.kind = 'sos'
    addLog(existing, 'Resident pressed "I need help".')

    // G1d: SOS uses the same alert function (call before risk write so alert goes out even if scoring fails)
    await alertEmergency(state.householdId, existing.id)

    // P10: SOS appends a confirmed forced_entry_or_assault with source 'resident' and sets score to 100
    await addSosObservation(householdId, existing.id)

    await updateCase(existing.id, existing)
    return existing
  }
  const c = await openCase(state, 'sos', 'sos', 'Resident pressed "I need help".')
  // P10: SOS appends a confirmed forced_entry_or_assault with source 'resident' and sets score to 100
  await addSosObservation(householdId, c.id)
  return c
}

/**
 * G2: SOS appends a confirmed forced_entry_or_assault with source 'resident' through applyRiskEdit
 */
async function addSosObservation(householdId: string, caseId: string) {
  try {
    await applyRiskEdit(caseId, {
      kind: 'append',
      observation: {
        code: 'forced_entry_or_assault',
        at: new Date().toISOString(),
        quotes: ['Resident SOS pressed'],
        source: 'resident',
        state: 'confirmed',
        points: 0,
      },
    })
  } catch (e) {
    console.error('[G2] Failed to add SOS observation:', e)
  }
}

export async function ackCase(householdId: string, caseId: string, membershipId: string): Promise<{ ok: true; case: DoorCase } | { ok: false; error: string; status: number }> {
  const state = await getOrCreateState(householdId)
  const c     = state.cases.find(x => x.id === caseId)
  if (!c) return { ok: false, error: 'case not found', status: 404 }

  const membership = await getMembership(membershipId)
  if (!membership || membership.consent !== 'approved' || !c.chain.includes(membershipId)) {
    return { ok: false, error: 'not allowed', status: 403 }
  }

  if (!c.ackedAt) {
    c.ackedAt = Date.now(); c.ackedBy = membershipId
    addLog(c, `${membership.user.name} saw the alert.`)
    await updateCase(c.id, c)

    // Section 7: Mark all pending requests for this membership as acknowledged
    const { getRequestsForCase, markAcked } = await import('@/lib/doorstep/helperRequests')
    const requests = await getRequestsForCase(caseId)
    for (const request of requests) {
      if (request.membershipId === membershipId && (request.state === 'sent' || request.state === 'delivered')) {
        await markAcked(request.id)
      }
    }
  }
  return { ok: true, case: c }
}

export async function logView(householdId: string, caseId: string, membershipId: string, what: string) {
  const state = await getOrCreateState(householdId)
  const c     = state.cases.find(x => x.id === caseId)
  if (!c) return
  const membership = await getMembership(membershipId)
  addLog(c, `${membership?.user.name ?? membershipId} ${what}.`)
  await updateCase(c.id, c)
}

export const caseDevice = (householdId: string, caseId: string) => {
  const state = householdStates.get(householdId)
  if (!state) return null
  return state.cases.find(x => x.id === caseId)?.deviceId ?? null
}

export const isCaseOpenFor = async (householdId: string, caseId: string, membershipId: string) => {
  const state      = await getOrCreateState(householdId)
  const c          = state.cases.find(x => x.id === caseId)
  const membership = await getMembership(membershipId)
  return !!c && !!membership && membership.consent === 'approved' && c.chain.includes(membershipId) && Date.now() - c.createdAt < 30 * 60_000
}

// ── Self-verify (resident checks pass-word or live code) ──────────────────────

const hasCheck = (c: DoorCase) => !!c.checkWord || c.checkMode === 'code'

async function markUsed(state: HouseholdState, c: DoorCase) {
  if (!c.expectedId) return
  const e = state.expected.find(x => x.id === c.expectedId)
  if (!e || !e.singleUse || e.usedAt) return
  e.usedAt = Date.now()
  await markExpectedUsed(e.id, e.usedAt).catch(err => console.error('[STORE] could not mark visit used', err))
}

export async function selfVerify(
  householdId: string,
  caseId:      string,
  ok:          boolean
): Promise<DoorCase | null> {
  const state     = await getOrCreateState(householdId)
  const c         = state.cases.find(x => x.id === caseId)
  if (!c) return null
  // Only applicable to a waiting expected-visitor case that has a check
  if (c.kind !== 'visitor' || c.status !== 'waiting' || c.lane !== 'expected' || !hasCheck(c)) return null

  // H-30: Refuse when S_eff ≥ 20
  const sEff = effectiveScore(c.riskScore ?? 0, c.controlMode as ControlMode | null)
  if (sEff >= 20) {
    console.log('[selfVerify] Refused: score ≥ 20')
    return null
  }

  // H-30: Check for pending approvals
  const { getPendingActions, approvePendingAction } = await import('./pendingActions')
  const pendingActions = await getPendingActions(caseId)
  const pendingApproval = pendingActions.find(a => a.state === 'pending' && a.kind === 'visit_approval')
  if (pendingApproval) {
    // If it's a resident approval, approve it
    if (pendingApproval.approver === 'resident') {
      await approvePendingAction(caseId, pendingApproval.id, 'resident')
    } else {
      // Helper approval pending - refuse
      console.log('[selfVerify] Refused: helper approval pending')
      return null
    }
  }

  const household = await getHousehold(householdId)
  if (!household) return null
  const now      = Date.now()
  const approved = await getApprovedMemberships(householdId)

  if (ok) {
    // Resident confirmed → case resolved as safe
    c.status         = 'answered'
    c.answer         = 'safe'
    c.selfVerifiedAt = now
    c.confirmedAt    = now
    c.resolvedAt     = now
    addLog(c, `Resident confirmed the visitor (${c.checkWho ?? c.visitLabel}). Door can be opened.`)
    // Mark the single-use visit as used
    await markUsed(state, c)
    // Notify all helpers; they can still override to not_safe within 5 min
    approved.forEach(m => pushToMembership(m.id, {
      title: `${c.visitIcon ?? '👤'} ${c.visitLabel ?? 'Visitor'} verified`,
      body:  `${household.residentName} confirmed the visitor. You can still say Don't open.`,
      tag: c.id, url: '/helper'
    }))
  } else if (c.checkMode === 'code' && (c.checkAttempts ?? 0) + 1 < CODE_MAX_ATTEMPTS) {
    // Code mode — first "No": grant one retry
    c.checkAttempts = (c.checkAttempts ?? 0) + 1
    addLog(c, `Resident said the number did not match. Asked them to have it read out again. (attempt ${c.checkAttempts}/${CODE_MAX_ATTEMPTS})`)
  } else {
    // Word mode first "No", or code mode second "No" → demote to normal lane
    c.lane       = 'normal'
    c.checkWord  = undefined
    c.checkMode  = undefined
    c.deadlineAt = now + state.timeoutSec * 1000
    c.deadlineKind = 'household'
    c.timerDeadlines = { household: c.deadlineAt }
    addLog(c, 'Resident said the visitor did NOT pass the check. Treated as an unknown visitor: full alert and SMS.')
    const first = approved.find(m => m.id === c.chain[c.helperIndex])
    if (first) {
      pushToMembership(first.id, { title: '🚪 Someone is at the door', body: `The expected visitor did not pass the check. Open the app. You have ${state.timeoutSec}s.`, tag: c.id, url: '/helper' })
      if (first.user.phone) sendSms(first.user.phone, `Someone is at ${household.residentName}'s door and did not pass the check. Open the helper app now. You have ${state.timeoutSec}s.`, { urgent: true })
    }
    // After demotion to normal lane, this becomes an unplanned visit - trigger AI interrogator
    void import('@/lib/ai/hooks').then((m) => m.onDoorEvent(householdId, { caseId: c.id, deviceId: null, kind: c.kind || '', lane: c.lane || null, expectedId: c.expectedId || null, recurringId: c.recurringId || null })).catch(() => {})
  }

  await updateCase(c.id, c)
  return c
}

// ── answerCase ────────────────────────────────────────────────────────────────

export async function answerCase(
  householdId:  string,
  caseId:       string,
  membershipId: string,
  answer:       Answer,
  visitor?:     Visitor
): Promise<{ ok: true; case: DoorCase } | { ok: false; error: string; status: number }> {
  const state = await getOrCreateState(householdId)
  await tick(householdId)
  const c = state.cases.find(x => x.id === caseId)
  if (!c) return { ok: false, error: 'case not found', status: 404 }

  const membership = await getMembership(membershipId)
  if (!membership || membership.consent !== 'approved' || !c.chain.includes(membershipId)) {
    return { ok: false, error: 'You are not allowed to answer this case', status: 403 }
  }

  // H-27: Refuse safe when kind === 'sos', S_eff ≥ 20, activeSerious > 0 or emergencyAlertedAt is set
  const sEff = effectiveScore(c.riskScore ?? 0, c.controlMode as ControlMode | null)
  const activeSerious = (c as any).activeSerious as number | undefined
  if (answer === 'safe') {
    if (c.kind === 'sos') {
      return { ok: false, error: 'Cannot mark SOS case as safe - close the case instead', status: 409 }
    }
    if (sEff >= 20) {
      return { ok: false, error: 'Cannot mark as safe with score ≥ 20', status: 409 }
    }
    if (activeSerious && activeSerious > 0) {
      return { ok: false, error: 'Cannot mark as safe with active serious events', status: 409 }
    }
    if (c.emergencyAlertedAt) {
      return { ok: false, error: 'Cannot mark as safe when emergency has been alerted', status: 409 }
    }
  }

  // H-27: call_me must not set status = 'answered' while S_eff ≥ 20
  if (answer === 'call_me' && sEff >= 20) {
    return { ok: false, error: 'Cannot set "call me" with score ≥ 20', status: 409 }
  }

  // Special case: resident self-verified safe but a helper overrides to not_safe within 5 min
  if (
    c.status === 'answered' &&
    c.selfVerifiedAt &&
    !c.answeredBy &&
    answer === 'not_safe' &&
    Date.now() - c.selfVerifiedAt < 5 * 60_000
  ) {
    c.answer      = 'not_safe'
    c.answeredBy  = membershipId
    c.confirmedAt = undefined
    c.declinedAt  = Date.now()
    c.resolvedAt  = Date.now()
    addLog(c, `${membership.user.name} overrode self-verification: NOT SAFE.`)
    await updateCase(c.id, c)
    return { ok: true, case: c }
  }

  // P13: Prevent helper from overriding resident's not-safe or keep-closed to safe
  if (c.status === 'answered' && c.answer === 'not_safe' && answer === 'safe') {
    return { ok: false, error: 'Cannot override resident not-safe decision', status: 403 }
  }

  if (c.status === 'answered') {
    if (c.answeredBy === membershipId) return { ok: true, case: c }
    return { ok: false, error: 'This case was already answered', status: 409 }
  }

  if (c.status === 'waiting' && c.kind === 'visitor' && c.chain.indexOf(membershipId) > c.helperIndex) {
    return { ok: false, error: 'It is not your turn yet', status: 409 }
  }

  c.status     = 'answered'
  c.answer     = answer
  c.visitor    = visitor
  c.answeredBy = membershipId
  c.resolvedAt = Date.now()
  const label  = answer === 'safe' ? 'SAFE' : answer === 'not_safe' ? 'NOT SAFE' : 'will CALL the resident'
  addLog(c, `${membership.user.name} answered: ${label}.`)
  if (answer === 'safe') await markUsed(state, c)
  await updateCase(c.id, c)

  // Section 7: accepted/declined describe the helper's response to the request, not the visitor verdict
  // These should be set via separate endpoints when the helper accepts/declines to handle the case
  // NOT tied to the answerCase verdict

  return { ok: true, case: c }
}

export async function confirmCase(householdId: string, caseId: string, ok: boolean): Promise<DoorCase | null> {
  const state = await getOrCreateState(householdId)
  const c     = state.cases.find(x => x.id === caseId)
  if (!c || c.status !== 'answered' || c.answer !== 'safe') return null

  // P13: If resident already declined (kept closed), cannot confirm to open
  if (c.declinedAt && ok) {
    addLog(c, 'Resident declined to open; confirmation blocked.')
    await updateCase(c.id, c)
    return c
  }

  if (ok && isQuiet(state, Date.now())) {
    c.declinedAt = Date.now(); c.resolvedAt = Date.now()
    addLog(c, 'Night lock is on. The door stays closed.')
  } else {
    if (ok) c.confirmedAt = Date.now()
    else    c.declinedAt  = Date.now()
    c.resolvedAt = Date.now()
    addLog(c, ok ? 'Resident confirmed: opening the door.' : 'Resident chose to keep the door closed.')
  }
  await updateCase(c.id, c)
  return c
}

// ── Device management ─────────────────────────────────────────────────────────

export async function setDeviceOnline(householdId: string, deviceId: string, online: boolean, source: string) {
  const state     = await getOrCreateState(householdId)
  const household = await getHousehold(householdId)
  if (!household) return

  const prev = state.devices[deviceId]
  if (prev && prev.online === online) return

  const now = Date.now()
  state.devices[deviceId] = { online, since: now, alertedAt: prev?.alertedAt }

  if (!online) {
    state.devices[deviceId].alertedAt = now
    notifyAll(state, '⚠️ Doorbell offline', `The doorbell cannot be reached (${source}). ${household.residentName} will NOT be alerted about visitors.`, `device-${deviceId}`)
    smsAll(state, `Doorbell for ${household.residentName} is OFFLINE. Visitors will not be detected. Please check it and call ${household.residentName}.`, household.residentName, false)

    // Mark camera unavailable on every open case for this household (spec 4.3 unavailable path).
    const openCases = state.cases.filter(c => c.status === 'waiting')
    for (const c of openCases) {
      applyRiskEdit(c.id, {
        kind: 'availability', device: 'camera', available: false,
        since: new Date(now).toISOString(), reason: `Doorbell offline (${source})`,
      }).catch(e => console.error('[STORE] availability mark failed', e))
    }
  } else if (prev) {
    notifyAll(state, '✅ Doorbell back online', 'The doorbell is working again.', `device-${deviceId}`)

    // Clear camera unavailable on every open case.
    const openCases = state.cases.filter(c => c.status === 'waiting')
    for (const c of openCases) {
      applyRiskEdit(c.id, {
        kind: 'availability', device: 'camera', available: true, since: new Date(now).toISOString(),
      }).catch(e => console.error('[STORE] availability clear failed', e))
    }
  }

  await saveState(householdId, state)
}

export const anyDeviceOffline = (state: HouseholdState) => Object.values(state.devices).some(d => !d.online)

const pollingHouseholds    = new Set<string>()
const ringFailuresByHousehold = new Map<string, number>()

async function pollDevicesForHousehold(householdId: string) {
  if (pollingHouseholds.has(householdId)) return
  if (!(await ringConfiguredForHousehold(householdId))) return
  pollingHouseholds.add(householdId)
  try {
    const connection = await getConnectionForHousehold(householdId)
    if (!connection) return
    const ids = await listDeviceIds(connection.id)
    for (const d of ids) {
      const online = await fetchDeviceOnline(connection.id, d)
      await setDeviceOnline(householdId, d, online, 'status check')
    }
    ringFailuresByHousehold.set(householdId, 0)
  } catch (e) {
    const failures = (ringFailuresByHousehold.get(householdId) || 0) + 1
    ringFailuresByHousehold.set(householdId, failures)
    if (failures % 10 === 0) console.error(`[RING] status poll failed for household ${householdId}`, failures, e)
    if (failures === 3) await setDeviceOnline(householdId, 'ring-api', false, 'Ring cannot be reached')
  } finally {
    pollingHouseholds.delete(householdId)
  }
}

// ── Visits: add / remove ──────────────────────────────────────────────────────

export async function addExpected(
  householdId: string,
  icon: string, label: string, startsAt: number, endsAt: number,
  who?: string, passphrase?: string
): Promise<ExpectedVisit> {
  const state = await getOrCreateState(householdId)
  const e: ExpectedVisit = { id: newId('exp'), icon, label, startsAt, endsAt, who: clean(who), passphrase: clean(passphrase), arrangedAt: Date.now() }
  await createExpectedVisit({ householdId, ...e })   // write first: a failed write leaves nothing half-created in memory
  state.expected.push(e)
  return e
}

/** Create an ExpectedVisit from an approved VisitRequest (code-mode, single-use). */
export async function addExpectedFromRequest(
  householdId: string,
  r: { requestId: string; name: string; purpose: Purpose; startsAt: number; endsAt: number }
): Promise<ExpectedVisit> {
  const state = await getOrCreateState(householdId)
  const p = PURPOSES[r.purpose] ?? PURPOSES.other
  const e: ExpectedVisit = {
    id:         newId('exp'),
    icon:       p.icon,
    label:      p.label,
    startsAt:   r.startsAt,
    endsAt:     r.endsAt,
    who:        clean(r.name),
    codeSecret: newSecret(),
    requestId:  r.requestId,
    singleUse:  true,
    arrangedAt: Date.now(),
  }
  await createExpectedVisit({ householdId, ...e })
  state.expected.push(e)
  return e
}

/** Return the current rotating code for a visit, or a state string if unavailable. */
export async function visitCodeFor(householdId: string, expectedId: string, now = Date.now()) {
  const state = await getOrCreateState(householdId)
  const e = state.expected.find(x => x.id === expectedId)
  if (!e || !e.codeSecret) return { state: 'gone' as const }
  if (e.usedAt)            return { state: 'used' as const }
  if (now < e.startsAt - GRACE_MS) return { state: 'early' as const }
  if (now >= e.endsAt + GRACE_MS)  return { state: 'late' as const }
  return { state: 'ok' as const, ...currentCode(e.codeSecret, now) }
}

export async function removeExpected(householdId: string, id: string) {
  const state = await getOrCreateState(householdId)
  const e = state.expected.find(x => x.id === id)
  state.expected = state.expected.filter(e => e.id !== id)
  await deleteExpectedVisit(householdId, id)
  // If this visit was created from a request, notify the visitor it was cancelled
  if (e?.requestId) {
    cancelRequestForVisit(householdId, e.requestId).catch(console.error)
  }
}

export async function addRecurring(
  householdId: string,
  v: {
    icon: string; label: string; days: number[]; everyNWeeks: number
    startMin: number; endMin: number; alertIfMissed: boolean; startNextWeek: boolean
    who?: string; passphrase?: string
  }
): Promise<RecurringVisit> {
  const state     = await getOrCreateState(householdId)
  const household = await getHousehold(householdId)
  if (!household) throw new Error('Household not found')

  const now      = Date.now()
  const thisWeek = zonedDayNumber(now, household.timezone) - zonedWeekday(now, household.timezone)
  const r: RecurringVisit = {
    id:            newId('rec'),
    icon:          v.icon,
    label:         v.label,
    days:          [...new Set(v.days)].sort(),
    everyNWeeks:   v.everyNWeeks,
    anchorWeek:    thisWeek + (v.startNextWeek ? 7 : 0),
    startMin:      v.startMin,
    endMin:        v.endMin,
    alertIfMissed: v.alertIfMissed,
    paused:        false,
    who:           clean(v.who),
    passphrase:    clean(v.passphrase),
  }
  await createRecurringVisit({ householdId, ...r })   // write first
  state.recurring.push(r)
  return r
}

export async function setRecurringPaused(householdId: string, id: string, paused: boolean) {
  const state = await getOrCreateState(householdId)
  const v     = state.recurring.find(x => x.id === id)
  if (v) { v.paused = paused; await updateRecurringVisit(id, { paused }) }
}

export async function removeRecurring(householdId: string, id: string) {
  const state = await getOrCreateState(householdId)
  state.recurring = state.recurring.filter(x => x.id !== id)
  await deleteRecurringVisit(householdId, id)
}

// ── Household settings ────────────────────────────────────────────────────────

export async function checkIn(householdId: string) {
  const state  = await getOrCreateState(householdId)
  state.checkinAt = Date.now()
  await updateHousehold(householdId, {})
}

export async function setQuiet(householdId: string, q: Quiet) {
  const state = await getOrCreateState(householdId)
  state.quiet = { enabled: !!q.enabled, startHour: q.startHour, endHour: q.endHour }
  await updateHousehold(householdId, { quietEnabled: q.enabled, quietStartHour: q.startHour, quietEndHour: q.endHour })
}

export async function setOffline(householdId: string, v: boolean) {
  const state = await getOrCreateState(householdId)
  state.offline = v
}

export async function setTimeoutSec(householdId: string, n: number) {
  const state = await getOrCreateState(householdId)
  state.timeoutSec = Math.max(3, Math.min(600, Math.floor(n)))
  await updateHousehold(householdId, { timeoutSec: state.timeoutSec })
}

export async function setPlannedMode(householdId: string, mode: PlannedMode) {
  const state      = await getOrCreateState(householdId)
  state.plannedMode = mode
  await updateHousehold(householdId, { plannedMode: mode })
}

export async function resetAll(householdId: string) {
  const state = await getOrCreateState(householdId)
  state.cases.length = 0
  state.offline      = false
  state.devices      = {}
  state.recurring    = []
  state.expected     = []
  // Re-read plannedMode from DB so tests that change it don't bleed into the next test
  const household = await getHousehold(householdId)
  if (household) state.plannedMode = asMode((household as any).plannedMode)
  await deleteOldCases(householdId, 0)
  await deleteOldExpectedVisits(householdId)
}

// ── Alert status ──────────────────────────────────────────────────────────────

const DEGRADED_FAILS = 3
let lastDegradedPushAt = 0

export function alertStatus(now = Date.now()) {
  const f = recentFailures(now)
  return { degraded: f.push >= DEGRADED_FAILS, recentSmsFailures: f.sms, recentPushFailures: f.push }
}

function warnIfAlertsFailing(state: HouseholdState, now: number) {
  const a = alertStatus(now)
  if (!a.degraded || now - lastDegradedPushAt < 60 * 60_000) return
  lastDegradedPushAt = now
  notifyAll(state, '⚠️ Alerts may not reach you', 'Some alerts failed to send. Check the helper app and call the resident if unsure.', 'alerts-degraded')
}

export const resetAlertWarning = () => { lastDegradedPushAt = 0 }

// ── Escalation wiring ─────────────────────────────────────────────────────────

/** Seconds the next helper gets (spec 5.3). `notice` provides the resident's short-notice policy and approval timer. */
async function caseTimeoutSec(caseId: string, householdSec: number, notice: NoticeSettings): Promise<{ seconds: number; kind: string }> {
  try {
    const row = await getDb().case.findUnique({ where: { id: caseId }, select: { riskScore: true, controlMode: true, noticeStatus: true } })
    const needsApproval = row?.noticeStatus === 'short_notice' && notice.shortNoticePolicy !== 'ai_handles'
    return backupTimeoutSec(row?.riskScore, row?.controlMode as ControlMode | null, householdSec, needsApproval, notice.approvalTimerSec)
  } catch { return { seconds: householdSec, kind: 'household' } }   // never block escalation on a read failure
}

/** Spec 6.1: the mode that governs a case is the more human-led of the stored event minimum and the band of its score.
 *  case.controlMode alone is only the event minimum, so a score-60 case built from M1-level events would read as M1. */
function modeOfCase(c: { riskScore?: number | null; controlMode?: string | null; effectiveMode?: string | null }): ControlMode {
  return maxMode(
    effectiveModeFor(c.riskScore, (c.controlMode as ControlMode | null | undefined) ?? null),
    ((c.effectiveMode as ControlMode | null | undefined) ?? 'ai_leads'),
  )
}

/** Database claim + alerts for one household. Used by tick() and by the worker sweep. */
function escalationDeps(householdId: string, residentName: string, timeoutSec: number): EscalationDeps {
  return {
    claim: (caseId, expect, change, log) => claimEscalationStep(caseId, expect, change, log),
    reload: async (caseId) => {
      const row = await getCase(caseId)
      if (!row) return null
      return {
        helperIndex: row.helperIndex,
        deadlineAt:  row.deadlineAt.getTime(),
        status:      row.status as CaseStatus,
        lane:        (row.lane as 'normal' | 'expected' | null) ?? undefined,
        resolvedAt:  row.resolvedAt?.getTime(),
        answer:      (row.answer as Answer | null) ?? undefined,
        answeredBy:  row.answeredBy ?? undefined,
        log:         (row.log as any) || [],
      }
    },
    nameOf: async (id) => (id ? (await getMembership(id))?.user.name : undefined),
    onStep: async (c, step) => {
      if (step.kind === 'expected_to_normal') {
        const first = step.fromId ? await getMembership(step.fromId) : null
        if (first) {
          pushToMembership(first.id, { title: '🚪 Someone is at the door', body: `Nobody confirmed the expected visit. Open the app. You have ${timeoutSec}s.`, tag: c.id, url: '/helper' })
          if (first.user.phone) {
            sendSms(first.user.phone, `Someone is at ${residentName}'s door. Open the helper app now. You have ${timeoutSec}s.`, { urgent: true })
          }
        }
        return
      }
      if (step.kind === 'emergency') {
        // Spec 7.2 emergency: every contact is alerted in parallel, exactly once (database claim inside alertEmergency).
        await alertEmergency(householdId, c.id)
        return
      }
      if (step.kind === 'exhausted') {
        // Spec 7.2 step 4: nobody accepted. Alert every configured contact together (push and SMS in parallel) and
        // wait for the sends so a failure lands in the case log instead of disappearing.
        const helperLed = controlModeRank(modeOfCase(c as any)) >= controlModeRank('helper_only')
        const body = helperLed
          ? `URGENT: nobody has answered for ${residentName}'s door and the case needs a helper. Do not open the door. Check the app or call them now.`
          : `Doorbell: nobody answered for ${residentName}. The door stays closed. Please call them now.`
        await smsAll({ householdId }, body, residentName, true, c.id)
        return
      }
      const to = step.toId ? await getMembership(step.toId) : null
      if (to) {
        pushToMembership(to.id, { title: `🚪 ${step.fromName ?? 'Someone'} did not answer`, body: 'It is your turn. Open the app.', tag: c.id, url: '/helper' })
        if (to.user.phone) {
          sendSms(to.user.phone, `Doorbell for ${residentName}: ${step.fromName ?? 'the first helper'} did not answer. It is your turn. Open the helper app now.`, { urgent: true })
        }
      }
      // Issue #4: When mode is helper-led (M3+) or higher, also re-notify the primary helper (chain[0])
      if (controlModeRank(modeOfCase(c as any)) >= controlModeRank('helper_only') && c.chain[0] && c.chain[0] !== step.toId) {
        const primary = await getMembership(c.chain[0])
        if (primary) {
          pushToMembership(primary.id, { title: '🚪 Reminder: still waiting', body: 'The case has moved to the next helper. Please check in.', tag: c.id, url: '/helper' })
        }
      }
    },
    onTimeout: async (caseId, membershipId) => {
      // Section 7: the helper missed their answer window, so expire their open requests for THIS case.
      // 'emergency' requests are never expired by this timer (see TIMER_EXPIRABLE_KINDS).
      const { expireHelperRequests } = await import('@/lib/doorstep/helperRequests')
      await expireHelperRequests(caseId, membershipId)
    },
  }
}

/**
 * Worker backstop. Finds waiting cases that are overdue in the DATABASE and escalates them,
 * so a case still escalates when the web process is down or restarting.
 * `graceMs` keeps this from racing the web server's own 1 s tick; if the web server got there
 * first the claim simply fails and nothing is sent twice.
 *
 * Section 7: Also handles approval retry for cases in no_response status.
 */
export async function sweepOverdueCases(graceMs = 3_000): Promise<number> {
  const rows = await getOverdueCases(graceMs)
  let steps = 0
  for (const row of rows) {
    try {
      const household = await getHousehold(row.householdId)
      if (!household) continue
      const { seconds: timeoutSec, kind: timeoutKind } = await caseTimeoutSec(row.id, household.timeoutSec || DEFAULT_ESCALATION_SECONDS, parseNoticeSettings(household))
      const chain = ((row.chain as any) as string[]) || []
      const c: DoorCase = {
        id: row.id, kind: row.kind as CaseKind, eventType: row.eventType,
        createdAt: row.createdAt.getTime(), helperIndex: row.helperIndex, deadlineAt: row.deadlineAt.getTime(),
        status: row.status as CaseStatus, log: ((row.log as any) || []),
        chain: chain.length ? chain : (await getApprovedMemberships(row.householdId)).map(m => m.id),
        lane: (row.lane as 'normal' | 'expected' | null) ?? undefined,
        // The backstop must see the same score and mode the live path sees, or every swept case reads as M0:
        // no primary re-notify and no URGENT SMS.
        riskScore: (row as any).riskScore ?? undefined,
        controlMode: (row as any).controlMode ?? undefined,
      }
      steps += await escalateDueCase(c, Date.now(), { timeoutSec, timeoutKind, decisionSec: DEFAULT_DECISION_SECONDS, noResponseSec: DEFAULT_NO_RESPONSE_SECONDS, expectedTimeoutSec: EXPECTED_TIMEOUT_SECONDS }, escalationDeps(row.householdId, household.residentName, timeoutSec))

      // Section 7: Approval retry for no_response cases
      const noticeStatus = (row as any).noticeStatus as string | undefined
      const noticeSettings = parseNoticeSettings(household)
      if (c.status === 'no_response' && noticeStatus === 'short_notice' && noticeSettings.shortNoticePolicy !== 'ai_handles') {
        // Spec 7.2 step 4: retry at the resident's chosen interval. No fixed retry count: the visit stays closed and
        // the request keeps going round the chain until someone answers or the retry window (24 h) ends.
        const approvalRetrySec = noticeSettings.approvalRetrySec
        const timeSinceDeadline = Date.now() - c.deadlineAt
        const retryInterval = Math.floor(timeSinceDeadline / (approvalRetrySec * 1000))
        if (retryInterval > 0 && timeSinceDeadline <= APPROVAL_RETRY_WINDOW_MS) {
          const { createHelperRequest, getLatestRequest } = await import('@/lib/doorstep/helperRequests')
          const { buildHelperRequest, formatPushNotification, formatSms } = await import('@/lib/doorstep/requestContent')
          const { contactHelper } = await import('@/lib/doorstep/contactLog')
          const { getPreferences } = await import('@/lib/db/preferences')

          // Send to the next helper in chain (circular, not everyone at once)
          // Round 1 asks the primary again, round 2 the backup, and so on around the chain.
          if (chain.length === 0) continue
          const nextIndex = (retryInterval - 1) % chain.length
          const nextMembershipId = chain[nextIndex]
          const memberships = await getApprovedMemberships(row.householdId)
          const membership = memberships.find(m => m.id === nextMembershipId)

          if (membership) {
            // Check if we already sent a retry request for this interval to THIS membership
            const existing = await getLatestRequest(c.id, nextMembershipId, 'approval')
            if (!existing || existing.round !== retryInterval) {
              const created = await createHelperRequest({
                caseId: c.id,
                membershipId: membership.id,
                kind: 'approval',
                round: retryInterval,
              })
              if (!created) continue // a live approval request already exists for this helper

              // Build request with real case data
              const riskScore = (row as any).riskScore as number | undefined
              const controlMode = (row as any).controlMode as string | undefined
              const riskObservations = (row as any).riskObservations as any
              const observations = (riskObservations?.observations as any[]) || []

              const prefs = await getPreferences(row.householdId)
              const content = buildHelperRequest(
                observations,
                (controlMode as any) || 'ai_leads',
                riskScore || 0,
                noticeStatus,
                prefs,
                undefined,
                c.id
              )
              const pushNotif = formatPushNotification(content)
              const smsBody = formatSms(content)

              await contactHelper(c.id, membership.id, { push: pushNotif, sms: smsBody }, created.id)
            }
          }
        }
      }
    } catch (e) {
      reportError(e, { fn: 'sweepOverdueCases', caseId: row.id })
    }
  }
  return steps
}

// ── Tick ──────────────────────────────────────────────────────────────────────

export async function tick(householdId?: string) {
  if (householdId) {
    const state     = await getOrCreateState(householdId)
    const household = await getHousehold(householdId)
    if (!household) return

    const now = Date.now()
    state.lastTickAt = now

    // Check database connectivity during tick
    try {
      await getDb().$queryRaw`SELECT 1`
      state.dbHealthy = true
    } catch (e) {
      state.dbHealthy = false
      console.error('[TICK] Database connectivity check failed for household', householdId, e)
    }

    warnIfAlertsFailing(state, now)

    for (const c of state.cases) {
      if (c.status !== 'waiting' || c.lifecycle === 'closed' || now < c.deadlineAt) continue
      try {
        const { seconds: timeoutSec, kind: timeoutKind } = await caseTimeoutSec(c.id, state.timeoutSec, parseNoticeSettings(household))
        const deps = escalationDeps(householdId, household.residentName, timeoutSec)
        await escalateDueCase(c, now, { timeoutSec, timeoutKind, decisionSec: DEFAULT_DECISION_SECONDS, noResponseSec: DEFAULT_NO_RESPONSE_SECONDS, expectedTimeoutSec: EXPECTED_TIMEOUT_SECONDS }, deps)
      } catch (e) {
        reportError(e, { householdId, fn: 'tick/escalate', caseId: c.id })
      }
    }

    checkMissedCheckin(state, now, household.timezone, household.residentName)
    checkMissedVisits(state, now, household.timezone, household.residentName)

    // Throttled request sweep (~every 30 s per household)
    if (now - state.lastRequestSweepAt > 30_000) {
      state.lastRequestSweepAt = now
      sweepRequests(householdId, now).catch(e => reportError(e, { householdId, fn: 'sweepRequests' }))
      // Section 8.2: close idle cases whose quiet period has passed.
      sweepQuietCases(householdId, now).catch(e => reportError(e, { householdId, fn: 'sweepQuietCases' }))
    }
  } else {
    for (const [hid] of householdStates) { await tick(hid) }
  }
}

export async function getHealth() {
  const now    = Date.now()
  const states = Array.from(householdStates.values())
  // "ready" means the app is running and has at least one household loaded.
  // It does NOT require an active case — that was wrong and caused constant 503s.
  const householdsLoaded = states.length

  // Check database connectivity
  let dbHealthy = true
  try {
    await getDb().$queryRaw`SELECT 1`
  } catch (e) {
    dbHealthy = false
    console.error('[HEALTH] Database connectivity check failed', e)
  }

  return {
    tickAgeMs:        states.length > 0 ? now - Math.max(...states.map(s => s.lastTickAt)) : null,
    ready:            true,   // app is alive; householdsLoaded tells you how many are in memory
    householdsLoaded,
    anyDeviceOffline: states.some(s => anyDeviceOffline(s)),
    openCases:        states.reduce((sum, s) => sum + s.cases.filter(c => c.status === 'waiting').length, 0),
    alerts:           alertStatus(now),
    dbHealthy,
  }
}

// ── Global scheduler ──────────────────────────────────────────────────────────

const gt = globalThis as unknown as { __doorbellTimer?: ReturnType<typeof setInterval>; __doorbellPoll?: ReturnType<typeof setInterval> }

if (!gt.__doorbellTimer) {
  gt.__doorbellTimer = setInterval(() => {
    tick().catch(e => reportError(e, { fn: 'tick/global' }))
  }, 1000)
  gt.__doorbellTimer.unref?.()
}

if (!gt.__doorbellPoll) {
  gt.__doorbellPoll = setInterval(async () => {
    for (const householdId of householdStates.keys()) {
      await pollDevicesForHousehold(householdId)
    }
  }, 60_000)
  gt.__doorbellPoll.unref?.()

  setInterval(async () => {
    for (const householdId of householdStates.keys()) {
      const connection = await getConnectionForHousehold(householdId)
      if (connection) forceRefreshConnection(connection.id).catch(e => reportError(e, { householdId, fn: 'forceRefreshConnection' }))
    }
    // Daily face-embedding retention purge (throttled inside purgeOldEnrollments to once/hour)
    const { purgeOldEnrollments } = await import('@/face/store').catch(() => ({ purgeOldEnrollments: null }))
    if (purgeOldEnrollments) purgeOldEnrollments().catch(e => reportError(e, { fn: 'purgeOldEnrollments' }))
  }, 24 * 60 * 60_000).unref?.()
}

async function getAllMembershipsForHousehold(householdId: string) {
  return getDb().membership.findMany({ where: { householdId }, include: { user: true }, orderBy: { position: 'asc' } })
}
