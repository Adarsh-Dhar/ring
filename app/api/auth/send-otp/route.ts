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
  if (!sid || !token || !from) return false

  // Support two Twilio modes:
  //   • Production accounts: plain Body text.
  //   • Trial accounts / pre-approved templates: Body = template name from
  //     TWILIO_TEMPLATE_NAME, or ContentSid + ContentVariables.
  //
  // TWILIO_OTP_BODY (optional): message template with {{code}} placeholder.
  //   Default: "Your doorbell-helper code: {{code}}. It expires in 10 minutes."
  //
  // TWILIO_CONTENT_SID (optional): if set, use the Twilio Content API instead
  //   of a plain Body.  The {{code}} value goes into ContentVariables slot "1".
  const tpl  = process.env.TWILIO_OTP_BODY ?? 'Your doorbell-helper code: {{code}}. It expires in 10 minutes.'
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
      console.error('[OTP SMS] Twilio error', res.status, await res.text())
      return false
    }
    return true
  } catch (e) {
    console.error('[OTP SMS] Twilio request failed', e)
    return false
  }
}

async function sendOtpEmail(to: string, code: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return false

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
      console.error('[OTP EMAIL] Resend error', res.status, await res.text())
      return false
    }
    return true
  } catch (e) {
    console.error('[OTP EMAIL] Resend request failed', e)
    return false
  }
}

// ── Route ──────────────────────────────────────────────────────────────────

/**
 * POST { email?, phone?, name? }
 *
 * Signup and login share the same endpoint.  A new address creates an account;
 * a known one reuses it.  The response is always { ok: true } regardless of
 * whether the address was new, whether it was rate-limited, or whether
 * delivery succeeded — callers must not be able to enumerate accounts or probe
 * rate-limit status.
 */
export async function POST(req: NextRequest) {
  const p = await parse(req, z.object({
    email: z.string().email().optional(),
    phone: z.string().min(7).max(20).optional(),
    name:  z.string().trim().min(1).max(60).optional(),
  }))
  if (p.ok === false) return p.res

  if (!p.data.email && !p.data.phone) {
    return fail('Email or phone required', 400)
  }

  // ── Normalise inputs ───────────────────────────────────────────────────────
  const phone = p.data.phone ? normalizePhone(p.data.phone) : null
  const email = p.data.email ? normalizeEmail(p.data.email) : null

  if (p.data.phone && !phone) return fail('Invalid phone number', 400)
  // email normalisation can't fail (zod already validated it), but guard anyway
  if (p.data.email && !email) return fail('Invalid email address', 400)

  const db = getDb()

  // ── IP-based rate-limit (checked before upsert to limit account creation) ──
  // Trust the first value in X-Forwarded-For, which Caddy sets to the real
  // client IP.  Do NOT trust this header if the app is directly Internet-facing
  // without a proxy.
  const ip          = (req.headers.get('x-forwarded-for')?.split(',')[0] ?? '').trim() || 'unknown'
  const windowStart = new Date(Date.now() - OTP_TTL_MS)

  const ipCount = await db.otpCode.count({
    where: { ip, createdAt: { gte: windowStart } },
  })
  if (ipCount >= OTP_MAX_PER_IP) {
    return NextResponse.json({ ok: true })
  }

  // ── Upsert user (signup = login) ───────────────────────────────────────────
  // `name` only written on INSERT to prevent a caller from renaming others.
  let user: { id: string }
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

  // ── Per-user rate-limit (counts ALL codes, not just unused ones) ───────────
  // Counting used codes too means an attacker who keeps requesting codes just
  // to burn them with wrong guesses can't escape the per-user window.
  const recent = await db.otpCode.count({
    where: { userId: user.id, createdAt: { gte: windowStart } },
  })
  if (recent >= OTP_MAX_PER_USER) {
    return NextResponse.json({ ok: true })
  }

  // Invalidate all previous unused codes — only the latest one is valid
  await db.otpCode.updateMany({
    where: { userId: user.id, used: false },
    data:  { used: true },
  })

  // ── Generate and persist ───────────────────────────────────────────────────
  const code      = crypto.randomInt(100_000, 999_999).toString()
  const codeHash  = hashOtp(code)
  const expiresAt = new Date(Date.now() + OTP_TTL_MS)

  await db.otpCode.create({
    data: { userId: user.id, codeHash, expiresAt, attempts: 0, ip },
  })

  // ── Deliver ────────────────────────────────────────────────────────────────
  if (!IS_PROD) {
    console.log(`[OTP DEV] ${email ?? phone} → ${code}`)
  } else {
    let delivered = false

    if (phone) delivered = await sendOtpSms(phone, code)
    if (!delivered && email) delivered = await sendOtpEmail(email, code)

    if (!delivered) {
      console.error(
        '[OTP] Failed to deliver code to', email ?? phone,
        '— check TWILIO_* and RESEND_API_KEY env vars'
      )
    }
  }

  return NextResponse.json({ ok: true })
}
