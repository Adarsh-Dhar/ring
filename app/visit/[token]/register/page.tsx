'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PURPOSES, PURPOSE_KEYS, type Purpose } from '@/lib/doorbell/purposes'

type PageState = 'loading' | 'ready' | 'gone' | 'off' | 'submitting'

/** Shrink to at most 640px on the longest side and re-encode as JPEG, so the upload stays small. */
function toJpeg(src: CanvasImageSource, w: number, h: number): string {
  const scale = Math.min(1, 640 / Math.max(w, h))
  const c = document.createElement('canvas')
  c.width = Math.round(w * scale); c.height = Math.round(h * scale)
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.85)
}

export default function RegisterRegularPage({ params }: { params: Promise<{ token: string }> }) {
  const router = useRouter()
  const [token, setToken] = useState('')
  const [resident, setResident] = useState('')
  const [pageState, setPageState] = useState<PageState>('loading')
  const [purpose, setPurpose] = useState<Purpose | null>(null)
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [note, setNote] = useState('')
  const [consent, setConsent] = useState(false)
  const [photo, setPhoto] = useState<string | null>(null)
  const [camOn, setCamOn] = useState(false)
  const [errMsg, setErrMsg] = useState('')
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)

  useEffect(() => {
    params.then(p => {
      setToken(p.token)
      fetch(`/api/regular-visitors/public/${p.token}`)
        .then(r => (r.ok ? r.json() : null))
        .then(d => {
          if (!d) { setPageState('gone'); return }
          setResident(d.resident)
          setPageState(d.enabled ? 'ready' : 'off')
        })
        .catch(() => setPageState('gone'))
    })
    return () => stopCam()
  }, [params])

  const stopCam = () => { stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; setCamOn(false) }

  const startCam = async () => {
    setErrMsg('')
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
      stream.current = s
      setCamOn(true)
      requestAnimationFrame(() => { if (video.current) { video.current.srcObject = s; void video.current.play() } })
    } catch {
      setErrMsg('Camera not available. Choose a photo instead.')
    }
  }

  const snap = () => {
    const v = video.current
    if (!v || !v.videoWidth) return
    setPhoto(toJpeg(v, v.videoWidth, v.videoHeight))
    stopCam()
  }

  const pickFile = (f: File | undefined) => {
    if (!f) return
    const img = new Image()
    img.onload = () => { setPhoto(toJpeg(img, img.width, img.height)); URL.revokeObjectURL(img.src) }
    img.onerror = () => setErrMsg('That file is not a readable image.')
    img.src = URL.createObjectURL(f)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!purpose) { setErrMsg('Please choose who you are.'); return }
    if (!photo)   { setErrMsg('Please take a photo of your face.'); return }
    if (!consent) { setErrMsg('Please tick the box to agree.'); return }
    setErrMsg(''); setPageState('submitting')
    const r = await fetch(`/api/regular-visitors/public/${token}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, purpose, note: note || undefined, contact, image: photo, consent: true, website: '' }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setErrMsg(j.error || 'Something went wrong. Please try again.'); setPageState('ready'); return }
    router.push(`/visit/r/${j.statusToken}`)
  }

  if (pageState === 'loading') return <main className="min-h-screen bg-slate-900 text-white flex items-center justify-center"><p>Loading…</p></main>
  if (pageState === 'gone' || pageState === 'off') {
    return (
      <main className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center gap-4 p-6">
        <div className="text-6xl">🔗</div>
        <h1 className="text-2xl font-bold">{pageState === 'off' ? 'Face registration is off' : 'This link is no longer active'}</h1>
        <p className="text-slate-400 text-center">Ask the family for the latest link.</p>
      </main>
    )
  }

  const input = 'w-full rounded-xl bg-slate-700 px-4 py-3 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500'

  return (
    <main className="min-h-screen bg-slate-900 text-white p-6 max-w-lg mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Become a regular visitor of {resident}</h1>
        <p className="text-slate-400 mt-1">Take a photo of your face. A helper or {resident} checks it, then the door camera will know it is you.</p>
      </header>

      <form onSubmit={submit} className="space-y-5">
        <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"
          style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden' }} />

        {/* Photo */}
        <div>
          <label className="block text-sm text-slate-400 mb-2">Your face</label>
          <div className="rounded-2xl bg-slate-800 p-3 flex flex-col items-center gap-3">
            {photo ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo} alt="Your photo" className="rounded-xl max-h-72" />
                <button type="button" onClick={() => setPhoto(null)} className="text-sm text-cyan-400">Retake</button>
              </>
            ) : camOn ? (
              <>
                <video ref={video} playsInline muted className="rounded-xl max-h-72 bg-black" />
                <button type="button" onClick={snap} className="w-full rounded-xl bg-cyan-600 py-3 font-bold">📸 Take photo</button>
              </>
            ) : (
              <>
                <button type="button" onClick={startCam} className="w-full rounded-xl bg-cyan-600 py-3 font-bold">📷 Use camera</button>
                <label className="w-full rounded-xl bg-slate-700 py-3 text-center cursor-pointer">
                  🖼️ Choose a photo
                  <input type="file" accept="image/*" capture="user" className="hidden" onChange={e => pickFile(e.target.files?.[0])} />
                </label>
              </>
            )}
            <p className="text-xs text-slate-500 text-center">Face the camera, good light, no hat or sunglasses, only you in the photo.</p>
          </div>
        </div>

        <div>
          <label className="block text-sm text-slate-400 mb-2">Who are you?</label>
          <div className="grid grid-cols-5 gap-2">
            {PURPOSE_KEYS.map(k => (
              <button key={k} type="button" onClick={() => setPurpose(k)} aria-pressed={purpose === k} aria-label={PURPOSES[k].label}
                className={`flex flex-col items-center gap-1 rounded-xl py-3 text-2xl transition-colors ${purpose === k ? 'bg-cyan-600 ring-2 ring-cyan-400' : 'bg-slate-700 hover:bg-slate-600'}`}>
                <span>{PURPOSES[k].icon}</span><span className="text-xs text-white">{PURPOSES[k].label}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="rv-name" className="block text-sm text-slate-400 mb-1">Your name</label>
          <input id="rv-name" required maxLength={40} value={name} onChange={e => setName(e.target.value)} className={input} placeholder="Full name" />
        </div>

        <div>
          <label htmlFor="rv-contact" className="block text-sm text-slate-400 mb-1">Phone or email</label>
          <input id="rv-contact" required maxLength={80} value={contact} onChange={e => setContact(e.target.value)} className={input} placeholder="+91… or name@example.com" />
          <p className="text-xs text-slate-500 mt-1">We tell you here when you are approved. Not shared with anyone.</p>
        </div>

        <div>
          <label htmlFor="rv-note" className="block text-sm text-slate-400 mb-1">Note <span className="text-slate-500">(optional)</span></label>
          <textarea id="rv-note" maxLength={120} value={note} onChange={e => setNote(e.target.value)} rows={2} className={input} placeholder="For example: Dr. Shah's clinic nurse, visits Tuesdays" />
        </div>

        <label className="flex items-start gap-3 rounded-xl bg-slate-800 p-3 text-sm">
          <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-1" />
          <span>
            I agree that my face is saved so the door camera can recognise me as a regular visitor. A helper or {resident} will see my photo to approve it.
            The photo is deleted once they decide; only a face code is kept. I can remove myself at any time.
          </span>
        </label>

        {errMsg && <p role="alert" className="rounded-xl bg-red-900 p-3 text-sm">{errMsg}</p>}

        <button type="submit" disabled={pageState === 'submitting'}
          className="w-full rounded-xl bg-cyan-600 py-4 text-lg font-bold text-white disabled:opacity-50 hover:bg-cyan-500 transition-colors">
          {pageState === 'submitting' ? 'Checking your photo…' : 'Send for approval'}
        </button>
      </form>
    </main>
  )
}
