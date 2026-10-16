'use client'

import { useEffect, useState } from 'react'

/** Shows ONLY the sentence a helper approved. Never drafts, never raw AI text. */
export default function ApprovedNote() {
  const [note, setNote] = useState<{ text: string; icon_char: string } | null>(null)
  useEffect(() => {
    let stop = false
    const load = async () => {
      try {
        const r = await fetch('/api/ai/notes/current', { cache: 'no-store' })
        if (r.ok && !stop) setNote((await r.json()).note)
      } catch { /* optional */ }
    }
    void load()
    const t = setInterval(load, 30_000)
    return () => { stop = true; clearInterval(t) }
  }, [])
  if (!note) return null
  return <p className="text-2xl max-w-sm" aria-live="polite">{note.icon_char} {note.text}</p>
}
