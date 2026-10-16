import { generateJson } from '@/lib/ai/client'
import { CompressorOut } from '@/lib/ai/schemas'
import { COMPRESSOR_SYSTEM } from '@/lib/ai/prompts/compressor'
import { clampWords, countWords, hasBannedPhrase, sanitize, wrapUntrusted } from '@/lib/ai/guard'
import { PURPOSES, type Purpose } from '@/lib/doorbell/purposes'
import { getDb } from '@/lib/db/client'

/** Agent 3. Draft only: the resident sees nothing until a helper approves. */
export async function compressNote(householdId: string, rawNote: string, residentName: string, whenText: string) {
  const raw = sanitize(rawNote, 400)
  const out = await generateJson({
    agent: 'compressor', householdId, role: 'workhorse', schema: CompressorOut, maxOutputTokens: 120,
    system: COMPRESSOR_SYSTEM,
    parts: [{ text: `Resident: ${sanitize(residentName, 60)}\nNow: ${sanitize(whenText, 60)}\n${wrapUntrusted('helper_note', raw, 400)}` }],
  })

  let text = out?.text ? clampWords(out.text, 8) : ''
  let icon: Purpose = out?.icon && out.icon in PURPOSES ? out.icon : 'other'
  let fallback = false
  if (!text || hasBannedPhrase(text) || countWords(text) > 8) {
    // AI down, over budget, or output rejected: fall back to a plain truncation, still needs approval.
    text = clampWords(raw, 8); icon = 'other'; fallback = true
    if (!text) return null
  }
  const row = await getDb().residentNote.create({ data: { householdId, rawNote: raw, draftText: text, icon, status: 'draft' } })
  return { id: row.id, text, icon, fallback }
}

export async function decideNote(
  householdId: string, id: string, approvedBy: string,
  d: { action: 'approve' | 'reject'; text?: string; icon?: string }
) {
  const note = await getDb().residentNote.findFirst({ where: { id, householdId } })
  if (!note || note.status !== 'draft') return null
  if (d.action === 'reject') {
    return getDb().residentNote.update({ where: { id }, data: { status: 'rejected', approvedBy, decidedAt: new Date() } })
  }
  const text = d.text !== undefined ? clampWords(sanitize(d.text, 120), 8) : note.draftText   // helper edits are re-validated too
  const icon = d.icon && d.icon in PURPOSES ? d.icon : note.icon
  if (!text || hasBannedPhrase(text)) return 'invalid' as const
  // Only one approved note at a time: retire older ones.
  await getDb().residentNote.updateMany({ where: { householdId, status: 'approved' }, data: { status: 'rejected' } })
  return getDb().residentNote.update({ where: { id }, data: { status: 'approved', approvedBy, decidedAt: new Date(), draftText: text, icon } })
}

export async function currentNote(householdId: string, maxAgeHours = 24) {
  const n = await getDb().residentNote.findFirst({
    where: { householdId, status: 'approved', decidedAt: { gte: new Date(Date.now() - maxAgeHours * 3_600_000) } },
    orderBy: { decidedAt: 'desc' },
  })
  return n ? { id: n.id, text: n.draftText, icon: n.icon, icon_char: PURPOSES[n.icon as Purpose]?.icon ?? '👤' } : null
}
