/**
 * Contact logging infrastructure (Section 7.2).
 *
 * Wraps push and SMS with detailed logging and failure tracking.
 * Updates HelperRequest.channels with delivery results.
 */
import { pushToMembership, sendSms, type PushPayload } from '@/lib/doorbell/notify'
import { getPushSubscriptionsForMembership } from '@/lib/db/push'
import { getMembership } from '@/lib/db/memberships'
import { updateChannels, type HelperRequest } from './helperRequests'
import { writeAudit, audit } from './audit'

export interface ContactResult {
  push: { sent: number; failed: number; noSubscription: boolean }
  sms: { ok: boolean; reason?: string }
}

/**
 * Contact a helper via push and SMS, logging results and updating the HelperRequest.
 */
export async function contactHelper(
  caseId: string,
  membershipId: string,
  payload: { push: PushPayload; sms: string },
  requestId?: string
): Promise<ContactResult> {
  const membership = await getMembership(membershipId)
  if (!membership) {
    return { push: { sent: 0, failed: 0, noSubscription: true }, sms: { ok: false, reason: 'membership not found' } }
  }

  const user = await (await import('@/lib/db/households')).getDb().user.findUnique({
    where: { id: membership.userId },
    select: { name: true, phone: true },
  })

  const userName = user?.name || 'Helper'

  // Push
  const subs = await getPushSubscriptionsForMembership(membershipId)
  let pushSent = 0
  let pushFailed = 0
  let noSubscription = false

  if (subs.length === 0) {
    noSubscription = true
    await writeAudit(caseId, audit.contactAttempt('push', membershipId, 'failed', 'no subscription'))
  } else {
    try {
      await pushToMembership(membershipId, payload.push)
      pushSent = 1
      await writeAudit(caseId, audit.contactAttempt('push', membershipId, 'sent'))
    } catch (e) {
      pushFailed = 1
      await writeAudit(caseId, audit.contactAttempt('push', membershipId, 'failed', (e as Error).message))
    }
  }

  // SMS
  let smsOk = false
  let smsReason: string | undefined

  if (user?.phone) {
    smsOk = await sendSms(user.phone, payload.sms)
    if (smsOk) {
      await writeAudit(caseId, audit.contactAttempt('sms', membershipId, 'sent'))
    } else {
      smsReason = 'delivery failed'
      await writeAudit(caseId, audit.contactAttempt('sms', membershipId, 'failed', smsReason))
    }
  } else {
    smsReason = 'no phone number'
    await writeAudit(caseId, audit.contactAttempt('sms', membershipId, 'failed', smsReason))
  }

  // Update HelperRequest channels if requestId provided
  if (requestId) {
    await updateChannels(requestId, {
      push: { sent: pushSent, failed: pushFailed, noSubscription },
      sms: { ok: smsOk, reason: smsReason },
    })
  }

  return {
    push: { sent: pushSent, failed: pushFailed, noSubscription },
    sms: { ok: smsOk, reason: smsReason },
  }
}
