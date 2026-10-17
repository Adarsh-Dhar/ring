'use client'

import { useEffect, useState } from 'react'

type InterrogationTurn = { question: string; transcript: string; timestamp: number }
type ChecklistItem = { slot: string; label: string; status: 'missing' | 'vague' | 'specific' | 'refused'; asked: number; note?: string }
type Claims = {
  name: string | null; organisation: string | null; reason: string | null; forWhom: string | null; time: string | null
  checklist?: ChecklistItem[]
}

type RiskLevel = 'none' | 'low' | 'medium' | 'high'
type Risk = {
  level: RiskLevel
  labels?: string[]
  evidence?: { category: string; quote: string }[]
  rationale?: string
  action?: string | null
  source?: 'ai+rules' | 'rules' | 'live'
  score?: number
  ledger?: Array<{ code: string; at: string; quote: string; source: string; state: string; points: number }>
  minMode?: string
}

type Ai = {
  visitorSummary: string | null
  riskLevel?: RiskLevel | null
  riskAssessment?: Risk | null
  riskFlags: string[] | unknown
  interrogationState: string | null
  interrogationTurns: InterrogationTurn[] | unknown
  interrogationVerdict: string | null
  interrogationClaims: Claims | unknown
  riskScore?: number | null
  riskLedger?: Array<{ code: string; at: string; quote: string; source: string; state: string; points: number }> | unknown
  aiStatus?: 'succeeded' | 'processing' | 'disabled' | 'not_enabled' | 'failed' | 'not_applicable'
}

const STATUS_TEXT: Record<string, string> = {
  disabled: '⚠️ AI is off on this server (AI_DISABLED=1 or GEMINI_API_KEY missing).',
  not_enabled: '⚠️ AI is not enabled for this household. Turn it on in Setup → AI Helpers.',
  failed: '⚠️ AI analysis failed. Check server logs and /api/ai/usage.',
  not_applicable: '', // Planned visits don't show the card
}

const VERDICT_BADGE: Record<string, string> = {
  consistent: 'bg-emerald-700',
  inconsistent: 'bg-amber-700',
  evasive: 'bg-red-700',
  unclear: 'bg-slate-700',
}

const LABEL_BY_CAT: Record<string, string> = {
  urgency_pressure: 'Pressure to act quickly', payment_request: 'Money or card details',
  official_impersonation: 'Claims to be an official', entry_request: 'Wants to come inside',
  home_probing: 'Asked who else is at home', unsolicited_work: 'Selling or offering work nobody asked for',
  story_mismatch: 'Answers do not add up', evasive_answers: 'Avoided answering',
  manipulation_attempt: 'Tried to steer the assistant', known_scam_wording: 'Matches known tricks',
  vague_purpose: 'Reason stayed vague', unverifiable_claims: 'Could not back up claims', other: 'Other',
}
const RISK_BOX: Record<RiskLevel, string> = {
  none: 'bg-emerald-900/40 text-emerald-100',
  low: 'bg-slate-700 text-slate-100',
  medium: 'bg-amber-800/80 text-amber-50',
  high: 'bg-red-800/90 text-red-50',
}
const RISK_HEADLINE: Record<RiskLevel, string> = {
  none: '✅ No warning signs heard',
  low: 'ℹ️ Low concern',
  medium: '⚠️ Check this visitor',
  high: '🚨 High risk: classic doorstep-scam signs',
}


const PILL: Record<RiskLevel, string> = {
  none: 'bg-emerald-600 text-white',
  low: 'bg-slate-500 text-white',
  medium: 'bg-amber-500 text-black',
  high: 'bg-red-600 text-white',
}
const PILL_TEXT: Record<RiskLevel, string> = { none: 'RISK: NONE SO FAR', low: 'RISK: LOW', medium: 'RISK: MEDIUM', high: 'RISK: HIGH' }

/** P12: Categorize evidence into Observed, Inferred, Unknown */
type EvidenceGroup = 'observed' | 'inferred' | 'unknown'

function categorizeEvidence(ledgerEntry: { source: string; state: string; quote: string; retracted?: boolean }): EvidenceGroup {
  // Observed: sensors or exact words from transcript (confirmed)
  if (ledgerEntry.state === 'confirmed' && (ledgerEntry.source === 'sensor' || ledgerEntry.source === 'transcript')) {
    return 'observed'
  }
  // Inferred: system interpretation (helper/resident confirmations, uncertain with points from floor)
  if (ledgerEntry.source === 'helper' || ledgerEntry.source === 'resident' || ledgerEntry.state === 'uncertain') {
    return 'inferred'
  }
  // Retracted (rejected by helper): show as Unknown
  if (ledgerEntry.retracted) {
    return 'unknown'
  }
  // Unknown: unavailable or unestablished facts
  return 'unknown'
}

function groupEvidence(ledger: Array<{ code: string; at: string; quote: string; source: string; state: string; points: number; idx?: number; retracted?: boolean }>) {
  const groups: Record<EvidenceGroup, Array<typeof ledger[0]>> = {
    observed: [],
    inferred: [],
    unknown: [],
  }
  for (const entry of ledger) {
    const group = categorizeEvidence(entry)
    groups[group].push(entry)
  }
  return groups
}

/** P12: Handle helper confirm/reject of uncertain evidence */
async function handleObservationAction(caseId: string, idx: number, action: 'confirm' | 'reject') {
  try {
    const r = await fetch('/api/doorbell/observation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caseId, idx, action }),
    })
    if (!r.ok) {
      console.error('Failed to update observation:', await r.text())
    }
  } catch (e) {
    console.error('Failed to update observation:', e)
  }
}

/** Always visible, from the first answer. Updates live while the interview runs. */
function RiskBar({ level, live, turns }: { level: RiskLevel; live: boolean; turns: number }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2" role="status" aria-live="polite">
      <span className={`rounded-full px-3 py-1 text-sm font-bold tracking-wide ${PILL[level]}`}>{PILL_TEXT[level]}</span>
      <span className="text-xs text-slate-400">{live ? `Interview in progress${turns ? `, ${turns} answer${turns === 1 ? '' : 's'} so far` : ''}` : 'Interview finished'}</span>
    </div>
  )
}

/** Advisory AI info for an open case. Renders nothing for planned visits. */
export default function InterrogationCard({ caseId }: { caseId: string }) {
  const [ai, setAi] = useState<Ai | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stop = false
    const startedAt = Date.now()
    const MAX_POLL_MS = 1_800_000   // The interview has no turn limit, so allow a long one (30 min)
    const load = async () => {
      try {
        const r = await fetch(`/api/ai/cases/${encodeURIComponent(caseId)}`, { cache: 'no-store' })
        if (stop) return
        if (!r.ok) {
          setError(r.status === 401 || r.status === 403 ? 'Not authorised to load AI info.'
            : r.status === 404 ? 'Case not found.' : `Unable to load AI info (${r.status}).`)
          setAnalyzing(false); return
        }
        setError(null)
        const data = await r.json()
        setAi(data)
        // Terminal states: stop polling
        if (data.aiStatus && !['processing', 'succeeded'].includes(data.aiStatus)) { setAnalyzing(false); return }

        const interrogatorActive = data.interrogationState === 'asking' || data.interrogationState === 'listening'
        const finished = data.interrogationState === 'done' || data.interrogationState === 'failed' || data.interrogationState === 'unsupported'
        const timedOut = Date.now() - startedAt > MAX_POLL_MS
        if (finished) { setAnalyzing(false); return }
        if (timedOut) { setAnalyzing(false); setError('AI interrogation is taking too long. It may have failed.'); return }

        setAnalyzing(true)
        setTimeout(load, 3000)
      } catch { setError('Unable to load AI info (network error).'); setAnalyzing(false) }
    }
    void load()
    return () => { stop = true }
  }, [caseId])

  if (error) {
    return <p className="mb-3 rounded-xl bg-amber-900/60 p-3 text-sm text-amber-100">⚠️ {error}</p>
  }
  if (!ai && !analyzing) return null
  if (ai?.aiStatus === 'not_applicable') return null
  if (ai?.aiStatus && STATUS_TEXT[ai.aiStatus]) {
    return <p className="mb-3 rounded-xl bg-slate-800 p-3 text-sm text-slate-300">{STATUS_TEXT[ai.aiStatus]}</p>
  }

  const flags = Array.isArray(ai?.riskFlags) ? (ai.riskFlags as string[]) : []
  const turns = Array.isArray(ai?.interrogationTurns) ? (ai.interrogationTurns as InterrogationTurn[]) : []
  const claims = ai?.interrogationClaims as Claims | null
  const verdict = ai?.interrogationVerdict || 'unclear'
  const risk = ai?.riskAssessment ?? null
  const riskLevel: RiskLevel = (ai?.riskLevel as RiskLevel) || risk?.level || 'none'
  const hasRisk = riskLevel !== 'none'
  const ledger = Array.isArray(ai?.riskLedger) ? (ai.riskLedger as Array<{ code: string; at: string; quote: string; source: string; state: string; points: number; idx?: number; retracted?: boolean }>) : []
  const evidenceGroups = groupEvidence(ledger)

  // Show unsupported message
  if (ai?.interrogationState === 'unsupported') {
    return (
      <p className="mb-3 rounded-xl bg-slate-800 p-3 text-sm text-slate-300">
        🎙️ Interrogator unavailable on this doorbell (workspace simulation only)
      </p>
    )
  }

  // Show analyzing state
  if (analyzing && !ai?.visitorSummary && flags.length === 0 && !hasRisk) {
    const stateText = ai?.interrogationState === 'asking' ? '🎙️ Doorbell is asking a question…'
                    : ai?.interrogationState === 'listening' ? '🎙️ Doorbell is listening…'
                    : '🔍 AI is analysing…'
    return (
      <div className="mb-3 rounded-xl bg-slate-800 p-3 text-sm text-slate-300">
        <RiskBar level={riskLevel} live turns={turns.length} />
        {stateText}
      </div>
    )
  }

  // Show active interrogator state without results yet
  if (!ai?.visitorSummary && flags.length === 0 && !hasRisk) {
    return ai?.interrogationState === 'listening' || ai?.interrogationState === 'asking'
      ? (
        <div className="mb-3 rounded-xl bg-slate-800 p-3 text-sm text-slate-300">
          <RiskBar level={riskLevel} live turns={turns.length} />
          🎙️ Doorbell is asking the visitor questions…
        </div>
      )
      : null
  }

  return (
    <div className="mb-3 rounded-xl bg-slate-800 p-3 text-sm space-y-3">
      <RiskBar level={riskLevel} live={ai?.interrogationState === 'asking' || ai?.interrogationState === 'listening'} turns={turns.length} />
      {/* Risk assessment: the first thing a helper reads */}
      {(hasRisk || ai?.interrogationState === 'done') && (
        <div className={`rounded-lg p-3 ${RISK_BOX[riskLevel]}`}>
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold">{RISK_HEADLINE[riskLevel]}</p>
            {risk?.source === 'live' && <span className="text-xs opacity-80">still talking…</span>}
          </div>
          {risk?.rationale && <p className="mt-1">{risk.rationale}</p>}
          {Array.isArray(risk?.evidence) && risk!.evidence!.length > 0 && (
            <ul className="mt-2 space-y-1">
              {risk!.evidence!.map((e, i) => (
                <li key={i} className="text-xs">
                  <span className="opacity-80">{LABEL_BY_CAT[e.category] ?? e.category}:</span> "{e.quote}"
                </li>
              ))}
            </ul>
          )}
          {!risk?.evidence?.length && flags.length > 0 && (
            <ul className="mt-1 text-xs">{flags.map((f) => <li key={f}>• {f}</li>)}</ul>
          )}
          {risk?.action && <p className="mt-2 font-medium">{risk.action}</p>}
          <p className="mt-2 text-xs opacity-70">
            {risk?.source === 'ai+rules' ? 'AI judgement + keyword check' : 'Keyword check only (AI was unavailable)'}. Never open the door because of this alone.
          </p>
          {/* P12: Evidence grouped by Observed/Inferred/Unknown */}
          {ledger.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Evidence</p>
              {evidenceGroups.observed.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-emerald-300">Observed (sensors or exact words)</p>
                  <ul className="mt-1 space-y-1">
                    {evidenceGroups.observed.map((e, i) => (
                      <li key={i} className="text-xs flex items-start gap-2">
                        <span className="opacity-60">{new Date(e.at).toLocaleTimeString()}</span>
                        <span>
                          <span className="font-medium">{e.code}</span>
                          <span className="opacity-60"> ({e.source})</span>
                          {e.points > 0 && <span className="ml-1 text-emerald-400">+{e.points}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {evidenceGroups.inferred.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-amber-300">Inferred (system interpretation)</p>
                  <ul className="mt-1 space-y-1">
                    {evidenceGroups.inferred.map((e, i) => (
                      <li key={i} className="text-xs flex items-start gap-2">
                        <span className="opacity-60">{new Date(e.at).toLocaleTimeString()}</span>
                        <span className="flex-1">
                          <span className="font-medium">{e.code}</span>
                          <span className="opacity-60"> ({e.source}, {e.state})</span>
                          {e.points > 0 && <span className="ml-1 text-amber-400">+{e.points}</span>}
                          {/* Show the quote under each item */}
                          {e.quote && <span className="ml-2 text-xs opacity-80">"{e.quote}"</span>}
                        </span>
                        {/* P12: Confirm/reject controls for uncertain evidence */}
                        {e.state === 'uncertain' && e.idx !== undefined && (
                          <div className="flex gap-1">
                            <button
                              onClick={() => handleObservationAction(caseId, e.idx, 'confirm')}
                              className="px-2 py-0.5 text-xs bg-emerald-700 hover:bg-emerald-600 rounded"
                              title="Confirm this evidence"
                            >
                              ✓
                            </button>
                            <button
                              onClick={() => handleObservationAction(caseId, e.idx, 'reject')}
                              className="px-2 py-0.5 text-xs bg-red-700 hover:bg-red-600 rounded"
                              title="Reject this evidence"
                            >
                              ✗
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {evidenceGroups.unknown.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-slate-400">Unknown (unavailable or unestablished)</p>
                  <ul className="mt-1 space-y-1">
                    {evidenceGroups.unknown.map((e, i) => (
                      <li key={i} className="text-xs flex items-start gap-2 opacity-60">
                        <span>{new Date(e.at).toLocaleTimeString()}</span>
                        <span>
                          <span>{e.code}</span>
                          <span> ({e.state})</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {/* Real reason summary and verdict */}
      {ai?.visitorSummary && (
        <div>
          <p className="font-semibold">🎙️ Visitor's reason:</p>
          <p className="mt-1">{ai.visitorSummary}</p>
          <div className="mt-2 inline-flex items-center gap-2">
            <span className={`rounded-full px-2 py-1 text-xs font-medium ${VERDICT_BADGE[verdict]}`}>
              Verdict: {verdict}
            </span>
          </div>
        </div>
      )}

      {/* Q&A history */}
      {turns.length > 0 && (
        <div className="border-t border-slate-700 pt-3">
          <p className="font-semibold mb-2">Questions and answers:</p>
          <div className="space-y-2">
            {turns.map((t, i) => (
              <div key={i} className="rounded-lg bg-slate-900 p-2">
                <p className="text-slate-400 text-xs">Q: {t.question}</p>
                <p className="mt-1">A: {t.transcript || '(not understood)'}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Interview checklist: what the visitor did and did not give */}
      {Array.isArray(claims?.checklist) && claims!.checklist!.length > 0 && (
        <div className="border-t border-slate-700 pt-3">
          <p className="font-semibold mb-2">Interview checklist:</p>
          <ul className="space-y-1">
            {claims!.checklist!.map((c) => (
              <li key={c.slot} className="flex items-start gap-2 text-slate-300">
                <span aria-hidden>{c.status === 'specific' ? '✅' : c.status === 'refused' ? '⛔' : c.status === 'vague' ? '⚠️' : '➖'}</span>
                <span>
                  {c.label}
                  <span className="text-xs text-slate-400">
                    {' '}· {c.status === 'specific' ? 'given' : c.status === 'refused' ? 'declined' : c.status === 'vague' ? 'vague or not given' : 'not asked'}
                    {c.asked > 1 ? `, asked ${c.asked} times` : ''}{c.note ? `. ${c.note}` : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Claims */}
      {claims && (claims.name || claims.organisation || claims.reason || claims.forWhom || claims.time) && (
        <div className="border-t border-slate-700 pt-3">
          <p className="font-semibold mb-2">What the visitor claimed:</p>
          <ul className="space-y-1 text-slate-300">
            {claims.name && <li>• Name: {claims.name}</li>}
            {claims.organisation && <li>• Organisation: {claims.organisation}</li>}
            {claims.reason && <li>• Reason: {claims.reason}</li>}
            {claims.forWhom && <li>• For whom: {claims.forWhom}</li>}
            {claims.time && <li>• Time: {claims.time}</li>}
          </ul>
        </div>
      )}

      {/* Risk flags */}
      {flags.length > 0 && !risk && (
        <ul className="rounded-lg bg-amber-900/60 p-2 text-amber-100">
          {flags.map((f) => <li key={f}>⚠️ {f}</li>)}
        </ul>
      )}

      <p className="text-xs text-slate-400">AI summary, may be wrong. Check the person yourself.</p>
    </div>
  )
}
