/**
 * Section 8.2 "Every correction": each correction is also logged as labelled data for the validation tests (section 12).
 * Best effort. A failed label write must never fail the correction itself.
 */
import { getDb } from '@/lib/db/client'
import { reportError } from '@/lib/errors'

export type CorrectionAction = 'retract' | 'resolve' | 'dispute' | 'confirm' | 'restore' | 'reset' | 'statement' | 'split' | 'close' | 'visitor_left'

export interface CorrectionLabelInput {
  householdId: string
  caseId: string
  obsId?: string | null
  code?: string | null
  action: CorrectionAction
  actorRole: 'helper' | 'resident' | 'system'
  actorId?: string | null
  reason?: string | null
  scoreBefore?: number | null
  scoreAfter?: number | null
}

export async function logCorrectionLabel(l: CorrectionLabelInput): Promise<void> {
  try {
    await (getDb() as any).correctionLabel.create({
      data: {
        householdId: l.householdId, caseId: l.caseId, obsId: l.obsId ?? null, code: l.code ?? null, action: l.action,
        actorRole: l.actorRole, actorId: l.actorId ?? null, reason: l.reason ?? null,
        scoreBefore: l.scoreBefore ?? null, scoreAfter: l.scoreAfter ?? null,
      },
    })
  } catch (e) {
    reportError(e, { fn: 'logCorrectionLabel', caseId: l.caseId })
  }
}

/** The label action for a stored helper action name ('reject' is a retraction). */
export const labelActionFor = (a: 'confirm' | 'reject' | 'restore' | 'resolve'): CorrectionAction => (a === 'reject' ? 'retract' : a)
