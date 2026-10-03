import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { fail, parse } from '@/lib/guard'
import { getDb } from '@/lib/db/client'
import { IS_PROD } from '@/lib/auth'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const OTP_TTL_MS         = 10 * 60 * 1000  // 10 minutes
const OTP_MAX_PER_WINDOW = 5               // max sends per user per TTL window

function hashOtp(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex')
}

// ── SMS delivery via Twilio (same fetch pattern as notify.ts) ──────────────
async function sendOtpSms(to: string, code: string): Promise<boolean> {
  const sid   = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from  = process.env.TWILIO_FROM
  if (!sid || !token || !from) return false

  try {
    const body = process.env.TWILIO_TEMPLATE_NAME ?? `Your doorbell-helper code: ${code}`
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method:  'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: to, From: from, Body: body }),
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

// ── Email delivery via Resend (fetch-based, no extra package needed) ────────
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

/**
 * POST { email } | { phone }
 *
 * Creates the user if they don't exist yet (signup + login use the same flow),
 * generates a 6-digit OTP, stores it hashed in the DB, and sends it.
 *
 * Response is always { ok: true } – we never reveal whether the address
 * already existed, or whether delivery succeeded.
 */
export async function POST(req: NextRequest) {
  const p = await parse(req, z.object({
    email: z.string().email().optional(),
    phone: z.string().min(7).max(20).optional(),
    name:  z.string().trim().min(1).max(60).optional(),  // used when creating a new account
  }))
  if (p.ok === false) return p.res

  if (!p.data.email && !p.data.phone) {
    return fail('Email or phone required', 400)
  }

  const db = getDb()

  // ── Upsert user (signup + login are the same step) ────────────────────────
  // We upsert so that a new phone/email creates an account automatically.
  // The `name` field is only written on insert; an existing user's name is
  // not overwritten to prevent a caller from renaming someone else.
  let user: { id: string }
  if (p.data.email) {
    user = await db.user.upsert({
      where:  { email: p.data.email },
      update: {},
      create: { email: p.data.email, name: p.data.name ?? null },
      select: { id: true },
    })
  } else {
    user = await db.user.upsert({
      where:  { phone: p.data.phone! },
      update: {},
      create: { phone: p.data.phone!, name: p.data.name ?? null },
      select: { id: true },
    })
  }

  // ── Rate-limit: max OTP_MAX_PER_WINDOW sends per user per window ──────────
  const windowStart = new Date(Date.now() - OTP_TTL_MS)
  const recent = await db.otpCode.count({
    where: {
      userId:    user.id,
      used:      false,
      createdAt: { gte: windowStart },
    },
  })
  if (recent >= OTP_MAX_PER_WINDOW) {
    return NextResponse.json({ ok: true })   // silent; don't leak rate-limit status
  }

  // Invalidate all previous unused codes so only the latest one works
  await db.otpCode.updateMany({
    where: { userId: user.id, used: false },
    data:  { used: true },
  })

  // ── Generate and persist the code ─────────────────────────────────────────
  const code      = crypto.randomInt(100_000, 999_999).toString()
  const codeHash  = hashOtp(code)
  const expiresAt = new Date(Date.now() + OTP_TTL_MS)

  await db.otpCode.create({
    data: { userId: user.id, codeHash, expiresAt, attempts: 0 },
  })

  // ── Delivery ───────────────────────────────────────────────────────────────
  if (!IS_PROD) {
    // Dev: print to server log only — never in the HTTP response
    console.log(`[OTP DEV] ${p.data.email ?? p.data.phone} → ${code}`)
  } else {
    let delivered = false

    if (p.data.phone) {
      delivered = await sendOtpSms(p.data.phone, code)
    }

    if (!delivered && p.data.email) {
      delivered = await sendOtpEmail(p.data.email, code)
    }

    if (!delivered) {
      // Log loudly but don't fail the request — the code is in the DB and the
      // user can retry.  A misconfigured delivery channel must not lock users out.
      console.error(
        '[OTP] Failed to deliver code to',
        p.data.email ?? p.data.phone,
        '— check TWILIO_* and RESEND_API_KEY env vars'
      )
    }
  }

  return NextResponse.json({ ok: true })
}
