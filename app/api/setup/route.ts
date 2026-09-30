import { NextRequest, NextResponse } from 'next/server'
import {
  getSetup,
  addHelper,
  removeHelper,
  moveHelper,
  setConsent,
  setQuiet,
  setTimeoutSec,
} from '@/lib/doorbell/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// If SETUP_PIN is set, every request must send it in the x-setup-pin header.
const denied = (req: NextRequest) => {
  const pin = process.env.SETUP_PIN
  return !!pin && req.headers.get('x-setup-pin') !== pin
}
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })
const ok = () => NextResponse.json({ ok: true })
const hour = (n: unknown) => {
  const x = Math.floor(Number(n))
  return Number.isFinite(x) ? Math.max(0, Math.min(23, x)) : 0
}

export async function GET(req: NextRequest) {
  if (denied(req)) return fail('PIN needed', 401)
  return NextResponse.json(getSetup())
}

export async function POST(req: NextRequest) {
  if (denied(req)) return fail('PIN needed', 401)
  const b = await req.json()
  switch (b.action) {
    case 'add': {
      const name = String(b.name || '').trim()
      const phone = String(b.phone || '').trim()
      const emoji = String(b.emoji || '🙂').slice(0, 8)
      if (!name || name.length > 30 || !/^\+\d{8,15}$/.test(phone)) {
        return fail('A name and a phone like +919876543210 are needed')
      }
      return NextResponse.json({ ok: true, helper: addHelper(name, phone, emoji) })
    }
    case 'remove':
      return removeHelper(b.id) ? ok() : fail('Keep at least one approved helper')
    case 'move':
      moveHelper(b.id, b.dir === -1 ? -1 : 1)
      return ok()
    case 'consent':
      if (!['approved', 'declined', 'pending'].includes(b.consent)) return fail('bad consent value')
      return setConsent(b.id, b.consent) ? ok() : fail('Not found, or it would leave no approved helper')
    case 'quiet':
      setQuiet({ enabled: !!b.enabled, startHour: hour(b.startHour), endHour: hour(b.endHour) })
      return ok()
    case 'timeout':
      setTimeoutSec(Number(b.value))
      return ok()
    default:
      return fail('unknown action')
  }
}
