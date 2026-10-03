import crypto from 'crypto'

export const CODE_STEP_MS = Number(process.env.VISIT_CODE_STEP_SEC || 60) * 1000

/** 3-digit code for the current step, plus when it changes. Same function on every caller. */
export function currentCode(secretHex: string, now = Date.now()) {
  const step = Math.floor(now / CODE_STEP_MS)
  const mac  = crypto.createHmac('sha256', secretHex).update(String(step)).digest()
  const code = String(mac.readUInt32BE(0) % 1000).padStart(3, '0')
  return { code, endsAt: (step + 1) * CODE_STEP_MS }
}
