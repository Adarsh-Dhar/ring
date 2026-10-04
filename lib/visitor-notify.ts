import { sendSms } from './doorbell/notify'
import { sendEmail } from './email'

const base = () => (process.env.APP_URL || '').replace(/\/$/, '')
export const statusUrl = (token: string) => `${base()}/visit/s/${token}`
export const regularStatusUrl = (token: string) => `${base()}/visit/r/${token}`
export const firstName = (full?: string | null) => (full ?? '').trim().split(/\s+/)[0] || 'the household'

export async function notifyVisitor(
  r: { contact: string; contactKind: string },
  text: string
): Promise<boolean> {
  try {
    return r.contactKind === 'sms'
      ? await sendSms(r.contact, text)
      : await sendEmail(r.contact, 'Your visit request', text)
  } catch { return false }
}

const when = (s: Date, e: Date) =>
  `${s.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} to ${e.toLocaleTimeString([], { timeStyle: 'short' })}`

export const msgs = {
  approved:  (who: string, s: Date, e: Date, url: string) =>
    `Your visit to ${who} is approved for ${when(s, e)}. Open this link on the phone you will have at the door: ${url}`,
  declined:  (who: string) =>
    `Your visit request to ${who} was not approved.`,
  expired:   (who: string) =>
    `Your visit request to ${who} was not answered in time, so it was not added. You can send a new one.`,
  cancelled: (who: string) =>
    `Your visit request to ${who} was cancelled.`,
  link:      (url: string) =>
    `Your new visit link: ${url}`,
  regularApproved:  (who: string, url: string) =>
    `You are now a regular visitor for ${who}. Your face is saved only for the door camera. You can remove it any time: ${url}`,
  regularDeclined:  (who: string) =>
    `Your regular visitor registration for ${who} was not approved. Your photo has been deleted.`,
  regularExpired:   (who: string) =>
    `Your regular visitor registration for ${who} was not answered in time. Your photo has been deleted. You can register again.`,
  regularCancelled: (who: string) =>
    `Your regular visitor registration for ${who} was cancelled. Your photo has been deleted.`,
}
