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
  if (!init()) return []
  const dead: string[] = []
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(s, JSON.stringify(payload), { TTL: 60, urgency: 'high' })
      } catch (e: any) {
        if (e?.statusCode === 404 || e?.statusCode === 410) dead.push(s.endpoint)
        else console.error('[PUSH] failed', e?.statusCode ?? e)
      }
    })
  )
  return dead
}

export async function sendSms(to: string, body: string): Promise<boolean> {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM
  if (!sid || !token || !from) {
    // In tests, log and return true instead of throwing
    if (process.env.NODE_ENV === 'test') {
      console.log(`[SMS mock] to ${to}: ${body}`)
      return true
    }
    throw new Error('Twilio credentials are required. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM')
  }

  // Rate limit: skip if we sent to this number within the last minute
  const lastSent = smsLastSent.get(to) || 0
  const now = Date.now()
  if (now - lastSent < SMS_RATE_LIMIT_MS) {
    console.log(`[SMS] rate limited to ${to} (last sent ${now - lastSent}ms ago)`)
    return true // Pretend success to avoid cascading errors
  }

  try {
    // For Twilio trial accounts, use template SID instead of custom body
    const templateSid = process.env.TWILIO_TEMPLATE_SID
    const params: Record<string, string> = { To: to, From: from }

    if (templateSid) {
      // Use template for trial accounts
      params['ContentSid'] = templateSid
      params['ContentVariables'] = JSON.stringify({ message: body })
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
      return false
    }
    // Only update last sent on success
    smsLastSent.set(to, now)
    return true
  } catch (e) {
    console.error('[SMS] failed', e)
    return false
  }
}
