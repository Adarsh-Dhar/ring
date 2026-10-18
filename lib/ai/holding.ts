/**
 * Holding script (spec 5.3): while a short-notice visit waits for approval, the AI may say one fixed line and
 * nothing else. The door stays closed and the visit does not proceed. If nobody approves, the approval timer
 * notifies the backup helper (never an approval by silence).
 */
import { getDb } from '@/lib/db/client'
import { pickTalkback } from '@/lib/ai/talkback'
import { gateOrAsk } from '@/lib/ai/agents/interrogator'
import { isHoldingCase } from '@/lib/doorstep/noticePolicy'

/** Speak the holding line once through a server-driven talkback. Returns true only if it was really played. */
export async function speakHoldingScript(householdId: string, caseId: string, deviceId: string | null): Promise<boolean> {
  const c = await getDb().case.findUnique({ where: { id: caseId }, select: { noticeStatus: true, status: true } })
  if (!isHoldingCase(c)) return false
  const tb = pickTalkback(deviceId)
  if (tb.name === 'sim' || !deviceId) return false                       // the sim page plays it from the script route
  if (!(await tb.serverDriven(householdId, deviceId))) return false
  const g = await gateOrAsk(householdId, caseId, 'safety_script')        // cost 0, always inside budget, still gated in code
  if (g.decision !== 'allow') return false
  const { interrogatorLines } = await import('@/lib/ai/talkback')
  return tb.say(householdId, deviceId, interrogatorLines(null).holding)
}
