/**
 * Input sanitising and output validation. Everything a visitor, calendar or helper typed is
 * UNTRUSTED DATA: it is wrapped in delimited blocks and never placed in the instruction part of a prompt.
 */

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g

export function sanitize(text: unknown, maxLen = 500): string {
  if (typeof text !== 'string') return ''
  return text
    .replace(CONTROL, '')
    .replace(/<\/?\s*untrusted[^>]*>/gi, '')   // can't close our delimiter early
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen)
}

export function wrapUntrusted(label: string, text: unknown, maxLen = 500): string {
  const safe = label.replace(/[^a-z0-9_]/gi, '').slice(0, 30) || 'data'
  return `<untrusted_data label="${safe}">\n${sanitize(text, maxLen)}\n</untrusted_data>`
}

export const countWords = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0)

export function clampWords(s: string, max: number): string {
  const w = s.trim().split(/\s+/)
  return w.length <= max ? s.trim() : w.slice(0, max).join(' ').replace(/[,;:]$/, '') + '…'
}

/** Phrases the visitor must never hear and the resident must never be shown. */
const BANNED = [
  /\bcome in\b/i, /\bi('| a)?ll open\b/i, /\bdoor (is|will be) (open|unlocked)\b/i,
  /\b(is|are) (home|here|inside|alone)\b/i, /\bnot (home|here|in)\b/i,
  /\bpassword\b/i, /\bpin\b/i, /\bwait here\b/i, /\bi promise\b/i, /\bguarantee\b/i,
  /\bcalendar\b/i, /\bappointment (is|was) (not )?(scheduled|booked)\b/i,
  // Accusation and threat words
  /\bscam\b/i, /\bfraud\b/i, /\b liar\b/i, /\bpolice\b/i, /\barrest/i,
]
export const hasBannedPhrase = (s: string) => BANNED.some(r => r.test(s))

/** A question put to a visitor: short, no resident details, no banned phrases, ends as a question. */
export function validQuestion(q: string, residentName?: string): boolean {
  if (!q || countWords(q) > 20) return false
  if (hasBannedPhrase(q)) return false
  if (residentName && residentName.length > 1 && q.toLowerCase().includes(residentName.toLowerCase())) return false
  return true
}

/** Tolerant JSON extraction: models sometimes wrap JSON in fences. */
export function extractJson(text: string): unknown {
  const t = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  try { return JSON.parse(t) } catch { /* try to find an object */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)) } catch { /* ignore */ } }
  return null
}
