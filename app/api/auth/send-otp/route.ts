// @ts-nocheck
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { fail, parse } from '@/lib/guard'
import { getDb } from '@/lib/db/client'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST {email | phone}: send an OTP code for login.
 * In production, this would send an email or SMS with the code.
 * For now, we'll just log it (development mode).
 */
export async function POST(req: NextRequest) {
  const p = await parse(req, z.object({
    email: z.string().email().optional(),
    phone: z.string().min(10).optional()
  }))
  if (!p.ok) return p.res

  if (!p.data.email && !p.data.phone) {
    return fail('Email or phone required', 400)
  }

  // Find or create user
  const db = getDb()
  let user
  if (p.data.email) {
    user = await db.user.upsert({
      where: { email: p.data.email },
      update: {},
      create: { email: p.data.email }
    })
  } else if (p.data.phone) {
    user = await db.user.upsert({
      where: { phone: p.data.phone! },
      update: {},
      create: { phone: p.data.phone }
    })
  }

  // Generate OTP code (6 digits)
  const otp = crypto.randomInt(100000, 999999).toString()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

  // Store OTP (in a real app, use a separate table or Redis)
  // For now, we'll store it in the user's name field temporarily (NOT PRODUCTION)
  // TODO: Implement proper OTP storage with rate limiting
  console.log(`[OTP] For ${p.data.email || p.data.phone}: ${otp} (expires at ${expiresAt.toISOString()})`)

  // In production, send email/SMS here
  // For development, just return the code in the response
  if (process.env.NODE_ENV !== 'production') {
    return NextResponse.json({ ok: true, otp, userId: user?.id })
  }

  return NextResponse.json({ ok: true, userId: user?.id })
}
