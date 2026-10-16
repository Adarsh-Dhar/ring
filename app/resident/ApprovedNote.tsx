'use client'

import { useEffect, useState, useRef } from 'react'

/** Shows ONLY the sentence a helper approved. Never drafts, never raw AI text. */
export default function ApprovedNote() {
  const [note, setNote] = useState<{ text: string; icon_char: string; id: string } | null>(null)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const spokenNoteIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    let stop = false
    const load = async () => {
      try {
        const r = await fetch('/api/ai/notes/current', { cache: 'no-store' })
        if (r.ok && !stop) {
          const data = await r.json()
          const newNote = data.note
          setNote(newNote)

          // Auto-read once per note id when it first appears
          if (newNote && newNote.id && !spokenNoteIds.current.has(newNote.id)) {
            spokenNoteIds.current.add(newNote.id)
            speak(newNote.text)
          }
        }
      } catch { /* optional */ }
    }
    void load()
    const t = setInterval(load, 30_000)
    return () => { stop = true; clearInterval(t) }
  }, [])

  const speak = (text: string) => {
    if (!window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.onstart = () => setIsSpeaking(true)
    utterance.onend = () => setIsSpeaking(false)
    utterance.onerror = () => setIsSpeaking(false)
    window.speechSynthesis.speak(utterance)
  }

  const handleListen = () => {
    if (note) speak(note.text)
  }

  if (!note) return null
  return (
    <div className="flex items-center gap-3">
      <p className="text-2xl max-w-sm" aria-live="polite">{note.icon_char} {note.text}</p>
      <button
        onClick={handleListen}
        disabled={isSpeaking}
        className="text-2xl hover:scale-110 transition-transform disabled:opacity-50"
        aria-label="Listen to note"
      >
        🔊
      </button>
    </div>
  )
}
