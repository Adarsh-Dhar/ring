/**
 * Holding script (spec 5.3): while a short-notice visit waits for approval, the AI may say one fixed line and
 * nothing else. The door stays closed and the visit does not proceed. If nobody approves, the approval timer
 * notifies the backup helper (never an approval by silence).
 */
import { getDb } from '@/lib/db/client'
import { pickTalkback } from '@/lib/ai/talkback'
import { dispatchAiAction } from '@/lib/doorstep/toolDispatcher'
import { isHoldingCaseFor } from '@/lib/doorstep/holdState'

/** Speak the holding line once through a server-driven talkback. Returns true only if it was really played. */
export async function speakHoldingScript(householdId: string, caseId: string, deviceId: string | null): Promise<boolean> {
  const c = await getDb().case.findUnique({ where: { id: caseId }, select: { id: true, noticeStatus: true, status: true } })
  if (!(await isHoldingCaseFor(householdId, c))) return false
  const tb = pickTalkback(deviceId)
  if (tb.name === 'sim' || !deviceId) return false                       // the sim page asks for it through /api/ai/interrogator/line
  if (!(await tb.serverDriven(householdId, deviceId))) return false
  // cost 0, always inside budget, still gated, audited and played through the dispatcher
  const d = await dispatchAiAction({ householdId, caseId, line: 'holding', play: (t) => tb.say(householdId, deviceId, t) })
  return d.allowed
}
