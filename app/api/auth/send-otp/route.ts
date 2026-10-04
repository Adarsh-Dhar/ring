import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { fail, parse } from '@/lib/guard'
import { getDb } from '@/lib/db/client'
import { IS_PROD } from '@/lib/auth'
import { normalizePhone, normalizeEmail } from '@/lib/identity'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const OTP_TTL_MS         = 10 * 60 * 1000  // 10 minutes
const OTP_MAX_PER_USER   = 5               // max sends per user per window
const OTP_MAX_PER_IP     = 10              // max sends per IP per window

function hashOtp(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex')
}

// ── Delivery helpers ───────────────────────────────────────────────────────

async function sendOtpSms(to: string, code: string): Promise<boolean> {
  const sid   = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from  = process.env.TWILIO_FROM
  if (!sid || !token || !from) {
    console.error('[OTP SMS] Missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_FROM env vars')
    return false
  }

  const tpl      = process.env.TWILIO_OTP_BODY ?? 'Your doorbell-helper code: {{code}}. It expires in 10 minutes.'
  const bodyText = tpl.replace('{{code}}', code)
  const contentSid = process.env.TWILIO_CONTENT_SID

  const params: Record<string, string> = { To: to, From: from }
  if (contentSid) {
    params['ContentSid']       = contentSid
    params['ContentVariables'] = JSON.stringify({ '1': code })
  } else {
    params['Body'] = bodyText
  }

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method:  'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body:   new URLSearchParams(params),
        signal: AbortSignal.timeout(10_000),
      }
    )
    if (!res.ok) {
      const body = await res.text()
      console.error('[OTP SMS] Twilio returned an error', res.status, body)
      return false
    }
    return true
  } catch (e) {
    console.error('[OTP SMS] Network request to Twilio failed', e)
    return false
  }
}

async function sendOtpEmail(to: string, code: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error('[OTP EMAIL] RESEND_API_KEY is not set')
    return false
  }

  const fromEmail = process.env.RESEND_FROM ?? 'noreply@' + (process.env.DOMAIN ?? 'example.com')
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    fromEmail,
        to:      [to],
        subject: 'Your doorbell-helper sign-in code',
        html:    `<p>Your sign-in code is: <strong>${code}</strong></p><p>It expires in 10 minutes and can only be used once.</p>`,
        text:    `Your doorbell-helper sign-in code: ${code}\n\nExpires in 10 minutes.`,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const body = await res.text()
      console.error('[OTP EMAIL] Resend returned an error', res.status, body)
      return false
    }
    return true
  } catch (e) {
    console.error('[OTP EMAIL] Network request to Resend failed', e)
    return false
  }
}

// ── Route ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const p = await parse(req, z.object({
    email: z.string().email().optional(),
    phone: z.string().min(7).max(20).optional(),
    name:  z.string().trim().min(1).max(60).optional(),
  }))
  if (p.ok === false) return p.res

  if (!p.data.email && !p.data.phone) {
    return fail('Please provide either an email address or a phone number', 400)
  }

  const phone = p.data.phone ? normalizePhone(p.data.phone) : null
  const email = p.data.email ? normalizeEmail(p.data.email) : null

  if (p.data.phone && !phone) {
    return fail(`"${p.data.phone}" is not a valid phone number. Use E.164 format, e.g. +919876543210`, 400)
  }
  if (p.data.email && !email) {
    return fail(`"${p.data.email}" is not a valid email address`, 400)
  }

  let db
  try {
    db = getDb()
  } catch (e) {
    console.error('[SEND-OTP] Failed to get database connection', e)
    return fail('Database is unavailable. Please try again shortly.', 503)
  }

  const ip          = (req.headers.get('x-forwarded-for')?.split(',')[0] ?? '').trim() || 'unknown'
  const windowStart = new Date(Date.now() - OTP_TTL_MS)

  try {
    const ipCount = await db.otpCode.count({
      where: { ip, createdAt: { gte: windowStart } },
    })
    if (ipCount >= OTP_MAX_PER_IP) {
      // Intentionally vague to the caller — don't reveal rate limit details
      return NextResponse.json({ ok: true })
    }
  } catch (e) {
    console.error('[SEND-OTP] Failed to check IP rate limit', e)
    return fail('Unable to process request. Please try again.', 503)
  }

  let user: { id: string }
  try {
    if (email) {
      user = await db.user.upsert({
        where:  { email },
        update: {},
        create: { email, name: p.data.name ?? null },
        select: { id: true },
      })
    } else {
      user = await db.user.upsert({
        where:  { phone: phone! },
        update: {},
        create: { phone: phone!, name: p.data.name ?? null },
        select: { id: true },
      })
    }
  } catch (e) {
    console.error('[SEND-OTP] Failed to upsert user', e)
    return fail('Unable to create or find your account. Please try again.', 503)
  }

  try {
    const recent = await db.otpCode.count({
      where: { userId: user.id, createdAt: { gte: windowStart } },
    })
    if (recent >= OTP_MAX_PER_USER) {
      return NextResponse.json({ ok: true })
    }
  } catch (e) {
    console.error('[SEND-OTP] Failed to check per-user rate limit', e)
    return fail('Unable to process request. Please try again.', 503)
  }

  try {
    await db.otpCode.updateMany({
      where: { userId: user.id, used: false },
      data:  { used: true },
    })
  } catch (e) {
    console.error('[SEND-OTP] Failed to invalidate previous OTP codes', e)
    return fail('Unable to process request. Please try again.', 503)
  }

  const code      = crypto.randomInt(100_000, 999_999).toString()
  const codeHash  = hashOtp(code)
  const expiresAt = new Date(Date.now() + OTP_TTL_MS)

  try {
    await db.otpCode.create({
      data: { userId: user.id, codeHash, expiresAt, attempts: 0, ip },
    })
  } catch (e) {
    console.error('[SEND-OTP] Failed to store OTP code', e)
    return fail('Unable to generate sign-in code. Please try again.', 503)
  }

  if (!IS_PROD) {
    console.log(`[OTP DEV] ${email ?? phone} → ${code}`)
  } else {
    let delivered = false

    if (phone) delivered = await sendOtpSms(phone, code)
    if (!delivered && email) delivered = await sendOtpEmail(email, code)

    if (!delivered) {
      console.error('[OTP] Delivery failed for', email ?? phone,
        '— check TWILIO_* and RESEND_API_KEY env vars')
      // Still return ok:true — we never confirm or deny delivery to callers
    }
  }

  return NextResponse.json({ ok: true })
}
