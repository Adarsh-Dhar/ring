import webpush from 'web-push'

export interface PushSub {
  endpoint: string
  keys: { p256dh: string; auth: string }
}
export interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
}

/** Delivery failures, so the app can tell helpers when alerts are NOT getting through. */
const FAIL_WINDOW_MS = 10 * 60_000
const failures: { t: number; kind: 'sms' | 'push' }[] = []
export function recordFailure(kind: 'sms' | 'push', now = Date.now()) {
  failures.push({ t: now, kind })
  while (failures.length && now - failures[0].t > FAIL_WINDOW_MS) failures.shift()
}
export function recentFailures(now = Date.now()) {
  const recent = failures.filter((f) => now - f.t <= FAIL_WINDOW_MS)
  return { sms: recent.filter((f) => f.kind === 'sms').length, push: recent.filter((f) => f.kind === 'push').length }
}
export function resetFailures() { failures.length = 0 }

let ready = false
function init() {
  if (ready) return true
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv) {
    // In tests, log and return early instead of throwing
    if (process.env.NODE_ENV === 'test') {
      console.log('[PUSH] VAPID keys not configured in test environment')
      return false
    }
    throw new Error('VAPID keys are required. Set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY')
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', pub, priv)
  ready = true
  return true
}

// Simple SMS rate limiter: at most 1 SMS per phone per minute
const smsLastSent = new Map<string, number>()
const SMS_RATE_LIMIT_MS = 60_000 // 1 minute

/** Sends to every subscription. Returns endpoints that are gone (404/410) so the caller can delete them. */
export async function pushToSubs(subs: PushSub[], payload: PushPayload): Promise<string[]> {
  if (!subs.length) return []
  try {
    if (!init()) return []
  } catch (e) {
    console.error('[PUSH] not configured', (e as Error).message)
    subs.forEach(() => recordFailure('push'))
    return []
  }
  const dead: string[] = []
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(s, JSON.stringify(payload), { TTL: 60, urgency: 'high' })
      } catch (e: any) {
        if (e?.statusCode === 404 || e?.statusCode === 410) dead.push(s.endpoint)
        else { console.error('[PUSH] failed', e?.statusCode ?? e); recordFailure('push') }
      }
    })
  )
  return dead
}

export async function sendSms(to: string, body: string, opts: { urgent?: boolean } = {}): Promise<boolean> {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM
  if (!sid || !token || !from) {
    // In tests, log and return true instead of throwing
    if (process.env.NODE_ENV === 'test') {
      console.log(`[SMS mock] to ${to}: ${body}`)
      return true
    }
    // Never throw: a missing or broken SMS setup must not crash the server or stall an alert.
    console.error('[SMS] Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM.')
    recordFailure('sms')
    return false
  }

  // Rate limit: skip if we sent to this number within the last minute
  const lastSent = smsLastSent.get(to) || 0
  const now = Date.now()
  if (!opts.urgent && now - lastSent < SMS_RATE_LIMIT_MS) {
    console.log(`[SMS] rate limited to ${to} (last sent ${now - lastSent}ms ago)`)
    return false // suppressed on purpose; not a delivery failure
  }
  // Reserve the slot BEFORE the network call. Otherwise a burst of simultaneous alerts all pass this check
  // before the first one finishes, and the limiter does nothing.
  smsLastSent.set(to, now)


  try {
    // For Twilio trial accounts: use template name in Body parameter
    const templateName = process.env.TWILIO_TEMPLATE_NAME
    const params: Record<string, string> = { To: to, From: from }

    if (templateName) {
      // Use template for trial accounts (Body parameter contains template name)
      params['Body'] = templateName
    } else {
      // Use custom body for production accounts
      params['Body'] = body
    }

    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params),
    })
    if (!res.ok) {
      const errText = await res.text()
      console.error('[SMS] Twilio error', res.status, errText)
      recordFailure('sms')
      smsLastSent.delete(to)
      return false
    }
    return true
  } catch (e) {
    console.error('[SMS] failed', e)
    recordFailure('sms')
    smsLastSent.delete(to)
    return false
  }
}
