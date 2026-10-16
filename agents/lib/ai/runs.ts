import { getDb } from '@/lib/db/client'

export type RunStatus = 'ok' | 'invalid' | 'error' | 'budget' | 'disabled'

export async function logRun(r: {
  householdId: string; agent: string; model: string; status: RunStatus
  tokensIn?: number; tokensOut?: number; latencyMs?: number; caseId?: string | null
}) {
  try {
    await getDb().aiRun.create({ data: {
      householdId: r.householdId, agent: r.agent, model: r.model, status: r.status,
      tokensIn: r.tokensIn ?? 0, tokensOut: r.tokensOut ?? 0, latencyMs: r.latencyMs ?? 0, caseId: r.caseId ?? null,
    } })
  } catch { /* logging must never break the caller */ }
}
