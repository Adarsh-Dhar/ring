/**
 * The AI tool dispatcher (spec 9). Every live AI action that reaches the door goes through dispatchAiAction():
 *
 *   1. resolve the tool (a fixed line maps to its tool via LINE_TOOL; a model question or event response names one)
 *   2. gate it in code, in spec order: prohibited -> helper-only -> emergency-only -> resident restriction -> budget (S_eff)
 *   3. write an audit entry for EVERY allow and EVERY refusal
 *   4. only if allowed: hand the text to the caller (or play it through `play`), then write the interview stamp
 *      that the line stands for (greet -> respondingAt, entry_not_permitted -> entryDeniedAt, ...)
 *
 * Nothing else may say a fixed line or call the gate. tests/doorstep-dispatcher.test.ts fails if it does.
 * The gate itself (gateAction) stays pure. This file adds the case lookup, the helper-decision side effects,
 * the audit log and the stamps around it.
 */
import { getDb } from '@/lib/db/client'
import { getPreferences } from '@/lib/db/preferences'
import { gateAction, LINE_TOOL, type GateResult } from './actionGate'
import { MODE_FLOOR_SCORE } from './collaborationController'
import { requestHelperDecision } from './caseRiskStore'
import { createAuditEvent, writeAudit } from './audit'
import { interrogatorLines } from '@/lib/ai/talkback/lines'
import type { LineId } from '@/lib/ai/talkback/types'
import type { Decision } from './residentPreferences'
import { modeRank, type InterviewState } from './riskRules'

/** Which interview stamps a fixed line writes once it has been played. First write wins, see applyRiskEdit. */
export const LINE_STAMPS: Partial<Record<LineId, (keyof InterviewState)[]>> = {
  greet: ['respondingAt'],
  rules_explained: ['rulesExplainedAt'],
  boundary_stated: ['boundaryStatedAt'],
  asked_to_leave: ['askedToLeaveAt'],
  // Entry being denied also counts as a boundary.
  entry_not_permitted: ['entryDeniedAt', 'boundaryStatedAt'],
}

/** Stamps for scripted event responses, which are spoken as free text under one of four tools. */
const TOOL_STAMPS: Record<string, (keyof InterviewState)[]> = {
  restate_rule_refuse: ['rulesExplainedAt'],
  boundary_statement: ['boundaryStatedAt'],
  end_conversation: ['askedToLeaveAt'],
}

/** A scored behaviour that was ignored because its precondition line was never spoken -> the line that fixes that. */
export const PRECONDITION_LINE: Record<string, LineId> = {
  rules_not_explained_yet: 'rules_explained',
  boundary_not_stated_yet: 'boundary_stated',
  not_asked_to_leave_yet: 'asked_to_leave',
}

interface GateOpts { decision?: Decision; sEff?: number }

/** Spec 5.4: the backend, not the prompt, decides whether the AI may take an action alone.
 *  `sEff` lets a caller pass a fresher live score than the one stored; the higher of the two is used.
 *  Section 7.2: holdOnly stays true after status flips to no_response (until a helper accepts).
 *  Section 7.2: safetyOnly when helper-led with no helper answering. */
export async function gateFor(householdId: string, caseId: string, tool: string, o: GateOpts = {}): Promise<GateResult> {
  const row = await getDb().case.findUnique({ where: { id: caseId }, select: { riskScore: true, controlMode: true, noticeStatus: true, status: true } })
  const stored = Math.max(row?.riskScore ?? 0, MODE_FLOOR_SCORE[(row?.controlMode as keyof typeof MODE_FLOOR_SCORE) ?? 'ai_leads'] ?? 0)
  const sEff = Math.max(stored, o.sEff ?? 0)
  const isShortNotice = row?.noticeStatus === 'short_notice'
  const holdOnly = isShortNotice && (row?.status === 'waiting' || row?.status === 'no_response')
  const minMode = (row?.controlMode as any) || 'ai_leads'
  const safetyOnly = modeRank(minMode) >= modeRank('helper_only') && row?.status === 'no_response'
  return gateAction(tool, sEff, await getPreferences(householdId), { holdOnly, safetyOnly, decision: o.decision })
}

/** Gate, and when the AI is over budget start the risk-decision timer (spec 5.3) so a helper is asked. */
export async function gateOrAsk(householdId: string, caseId: string, tool: string, o: GateOpts = {}): Promise<GateResult> {
  const g = await gateFor(householdId, caseId, tool, o)
  // Section 7.3: a helper's single-use approval lets this one action through. A prohibited tool is never unlocked.
  if (g.decision === 'ask_helper') {
    const { consumeApprovedForTool } = await import('./pendingActions')
    const spent = await consumeApprovedForTool(caseId, tool).catch(() => null)
    if (spent) return { ...g, decision: 'allow' as const, reason: 'helper_approved' }
  }
  if (g.decision === 'ask_helper' && g.reason === 'over_budget') {
    await requestHelperDecision(caseId).catch(e => console.error('[dispatcher] requestHelperDecision', e))
  }
  if (g.decision === 'ask_helper') {
    // Best-effort: failing to record the request must not change the gate's answer or stop the AI turn.
    try {
      const { createPendingAction } = await import('./pendingActions')
      await createPendingAction(caseId, tool, tool, g.reason)
    } catch (e) {
      console.error('[dispatcher] createPendingAction', e)
    }
  }
  return g
}

export interface DispatchInput {
  householdId: string
  caseId: string
  /** A fixed talkback line. Its tool comes from LINE_TOOL. */
  line?: LineId
  /** Required when there is no `line` (a model question or a scripted event response). Ignored when `line` is set. */
  tool?: string
  /** Free text to speak (a validated model question, or a rendered event response). Defaults to the fixed line's text. */
  text?: string
  residentName?: string | null
  sEff?: number
  decision?: Decision
  /** Server-driven playback (Ring talkback). Stamps are written only if this resolves true. */
  play?: (text: string) => Promise<boolean>
}

export interface DispatchResult {
  allowed: boolean
  decision: GateResult['decision']
  reason: string
  tool: string
  line: LineId | null
  /** The words to speak. null whenever the action was refused, so a refused line never leaves the server. */
  text: string | null
}

/** Best-effort audit: a failed log write must never change what the AI is allowed to do or say. */
async function audit(caseId: string, detail: Record<string, unknown>) {
  try { await writeAudit(caseId, createAuditEvent('ai', 'ai_action', detail)) }
  catch (e) { console.error('[dispatcher] audit write failed', e) }
}

export async function dispatchAiAction(i: DispatchInput): Promise<DispatchResult> {
  const tool = i.line ? LINE_TOOL[i.line] : i.tool
  if (!tool) {
    const r: DispatchResult = { allowed: false, decision: 'deny', reason: 'unknown_tool', tool: String(i.tool ?? ''), line: null, text: null }
    await audit(i.caseId, { tool: r.tool, decision: 'blocked', reason: r.reason })
    return r
  }

  const g = await gateOrAsk(i.householdId, i.caseId, tool, { sEff: i.sEff, decision: i.decision })
  const line = i.line ?? null
  if (g.decision !== 'allow') {
    await audit(i.caseId, { tool, line, decision: 'blocked', gate: g.decision, reason: g.reason, cost: g.cost, budget: g.budget })
    return { allowed: false, decision: g.decision, reason: g.reason, tool, line, text: null }
  }

  const text = i.text ?? (line ? interrogatorLines(i.residentName)[line] : null)
  if (!text) {
    await audit(i.caseId, { tool, line, decision: 'blocked', reason: 'no_text' })
    return { allowed: false, decision: 'deny', reason: 'no_text', tool, line, text: null }
  }

  if (i.play && !(await i.play(text))) {
    await audit(i.caseId, { tool, line, decision: 'blocked', reason: 'playback_failed', cost: g.cost, budget: g.budget })
    return { allowed: false, decision: 'allow', reason: 'playback_failed', tool, line, text: null }
  }

  // The line is now going to the door: write what it stands for. A line has its own stamps; free text uses its tool's.
  const stamps = (line ? LINE_STAMPS[line] : TOOL_STAMPS[tool]) ?? []
  if (stamps.length) {
    try {
      const { applyRiskEdit } = await import('./caseRiskStore')
      for (const stampType of stamps) await applyRiskEdit(i.caseId, { kind: 'interview', stampType, at: new Date().toISOString() })
    } catch (e) {
      console.error('[dispatcher] stamp failed', e)
    }
  }
  await audit(i.caseId, { tool, line, decision: 'executed', reason: g.reason, cost: g.cost, budget: g.budget, stamps })
  return { allowed: true, decision: 'allow', reason: g.reason, tool, line, text }
}
