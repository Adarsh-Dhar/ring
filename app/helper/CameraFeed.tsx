'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Door camera feed for the helper. Plays an mp4 from videos/ as if it were a live stream:
 * looping, LIVE badge, running clock, random start point. Nothing is recorded.
 */
export default function CameraFeed({ file, caseId }: { file: string; caseId: string }) {
  const video = useRef<HTMLVideoElement>(null)
  const [clips, setClips] = useState<string[]>([])
  const [current, setCurrent] = useState(file)
  const [muted, setMuted] = useState(true)
  const [failed, setFailed] = useState(false)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => { setCurrent(file); setFailed(false) }, [file, caseId])
  useEffect(() => {
    fetch('/api/camera/list', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setClips(d.clips)).catch(() => {})
  }, [])
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])

  const onLoaded = () => {
    const v = video.current
    if (!v || !isFinite(v.duration) || v.duration < 4) return
    v.currentTime = Math.random() * (v.duration - 2) // join mid-way, like a real live stream
  }
  const next = () => {
    if (clips.length < 2) return
    setFailed(false)
    setCurrent(clips[(clips.indexOf(current) + 1) % clips.length])
  }

  return (
    <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
      {failed ? (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-amber-300">
          Camera feed unavailable. Check that <code className="mx-1">videos/{current}</code> exists and is H.264 mp4.
        </div>
      ) : (
        <video
          key={`${caseId}-${current}`}
          ref={video}
          src={`/api/doorbell/clip?file=${encodeURIComponent(current)}`}
          onLoadedMetadata={onLoaded}
          onError={() => setFailed(true)}
          autoPlay loop playsInline muted={muted}
          className="h-full w-full object-cover"
        />
      )}
      <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-xs font-bold text-white">
        <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> LIVE · Front door
      </span>
      <span className="absolute right-2 top-2 rounded bg-black/60 px-2 py-0.5 font-mono text-xs text-white">{now.toLocaleTimeString()}</span>
      <div className="absolute bottom-2 right-2 flex gap-2">
        {clips.length > 1 && <button onClick={next} className="rounded-full bg-black/60 px-3 py-1 text-xs text-white">🔀 Next camera</button>}
        <button onClick={() => setMuted((m) => !m)} className="rounded-full bg-black/60 px-3 py-1 text-xs text-white">{muted ? '🔈 Sound off' : '🔊 Sound on'}</button>
      </div>
    </div>
  )
}
