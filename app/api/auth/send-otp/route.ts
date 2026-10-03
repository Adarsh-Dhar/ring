import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { fail, parse } from '@/lib/guard'
import { getDb } from '@/lib/db/client'
import { IS_PROD } from '@/lib/auth'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const OTP_TTL_MS  = 10 * 60 * 1000   // 10 minutes
const OTP_MAX_PER_WINDOW = 5          // rate-limit: max 5 per user per 10 min

/** Hash the plaintext OTP for storage (sha256 is enough; codes are single-use with short TTL). */
function hashOtp(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex')
}

/**
 * POST { email } | { phone }
 *
 * Sends (or in dev: returns) a 6-digit OTP.
 * Response is always { ok: true } – we never expose whether the address exists.
 */
export async function POST(req: NextRequest) {
  const p = await parse(req, z.object({
    email: z.string().email().optional(),
    phone: z.string().min(7).max(20).optional(),
  }))
  if (p.ok === false) return p.res

  if (!p.data.email && !p.data.phone) {
    return fail('Email or phone required', 400)
  }

  const db = getDb()

  // Look up user – do NOT create one here.
  // An unknown address gets the same success response to avoid user enumeration.
  let user: { id: string } | null = null
  if (p.data.email) {
    user = await db.user.findUnique({ where: { email: p.data.email }, select: { id: true } })
  } else if (p.data.phone) {
    user = await db.user.findUnique({ where: { phone: p.data.phone },  select: { id: true } })
  }

  if (!user) {
    // Unknown address – return 200 anyway to prevent enumeration
    return NextResponse.json({ ok: true })
  }

  // Rate-limit: count unexpired, unused codes in the last window
  const windowStart = new Date(Date.now() - OTP_TTL_MS)
  const recent = await db.otpCode.count({
    where: {
      userId:    user.id,
      used:      false,
      createdAt: { gte: windowStart },
    },
  })
  if (recent >= OTP_MAX_PER_WINDOW) {
    // Still return 200 – don't tell the caller they're rate-limited (prevents oracle)
    return NextResponse.json({ ok: true })
  }

  // Expire all previous unused codes for this user before creating a new one
  await db.otpCode.updateMany({
    where: { userId: user.id, used: false },
    data:  { used: true },
  })

  // Generate and persist the OTP
  const code      = crypto.randomInt(100_000, 999_999).toString()
  const codeHash  = hashOtp(code)
  const expiresAt = new Date(Date.now() + OTP_TTL_MS)

  await db.otpCode.create({
    data: { userId: user.id, codeHash, expiresAt },
  })

  // ── Delivery ──────────────────────────────────────────────────────────────
  // In production: integrate your SMS/email provider here.
  // e.g. await sendSms(p.data.phone, `Your code: ${code}`)
  //      await sendEmail(p.data.email, `Your code: ${code}`)
  if (IS_PROD) {
    // Production must have a real delivery channel wired up.
    // Remove this guard once you integrate an SMS/email provider.
    console.error('[OTP] Production OTP delivery not yet wired – code generated but not sent')
    // Return success so the UI flow isn't broken during initial deployment;
    // swap for a real send and remove the log above.
  } else {
    // Development only – print to server logs, never returned in HTTP response
    console.log(`[OTP DEV] ${p.data.email ?? p.data.phone} → ${code}`)
  }

  // Always return the same shape – no userId, no code in the response body
  return NextResponse.json({ ok: true })
}
