'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { discoverRingDevice } from '@/lib/ring/camera'
import { useRecordedClips, RingClip } from '@/app/hooks/useRecordedClips'

function getSeverityColor(severity: number | undefined): string {
  if (severity === undefined) return 'bg-slate-600'
  if (severity <= 3) return 'bg-green-600'
  if (severity <= 6) return 'bg-yellow-600'
  if (severity <= 8) return 'bg-orange-600'
  return 'bg-red-600'
}

function getSeverityLabel(severity: number | undefined): string {
  if (severity === undefined) return '?'
  return severity.toString()
}

export default function ClipsPage() {
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [goTo, setGoTo] = useState('1')
  const queue = useRef<RingClip[]>([])
  const queuePos = useRef(0)
  const [playingAll, setPlayingAll] = useState(false)
  const [showOnlyDownloadable, setShowOnlyDownloadable] = useState(false)

  const c = useRecordedClips(deviceId)

  useEffect(() => {
    discoverRingDevice().then((id) => {
      if (id) setDeviceId(id)
      else c.setError('No Ring device found. Check your token.')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (deviceId) c.load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId])

  // Videos in number order, plus a check for numbers used twice
  const sorted = useMemo(
    () => {
      let clips = [...c.clips]
      if (showOnlyDownloadable) {
        clips = clips.filter(clip => clip.downloadable !== false)
      }
      return clips.sort((a, b) => (c.labels[a.id] ?? 1e9) - (c.labels[b.id] ?? 1e9))
    },
    [c.clips, c.labels, showOnlyDownloadable]
  )
  const dupes = useMemo(() => {
    const count: Record<number, number> = {}
    Object.values(c.labels).forEach((n) => (count[n] = (count[n] || 0) + 1))
    return count
  }, [c.labels])

  const stopAll = () => {
    queue.current = []
    setPlayingAll(false)
  }

  const playNumber = () => {
    const n = parseInt(goTo, 10)
    const clip = c.clipByLabel(n)
    stopAll()
    if (clip) {
      c.play(clip) // Allow all events now with VOD method
    }
    else c.setError(`No video is numbered ${goTo}.`)
  }

  const playAll = () => {
    if (!sorted.length) return
    // Allow all clips now with VOD method
    queue.current = sorted
    queuePos.current = 0
    setPlayingAll(true)
    c.play(sorted[0])
  }

  const onEnded = () => {
    if (!queue.current.length) return
    queuePos.current += 1
    if (queuePos.current < queue.current.length) c.play(queue.current[queuePos.current])
    else stopAll()
  }

  const commitLabel = (id: string, raw: string) => {
    const n = parseInt(raw, 10)
    if (!Number.isNaN(n) && n > 0) c.setLabel(id, n)
  }

  const currentLabel = c.current ? c.labels[c.current.clip.id] : null

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-dash-panel border-b border-slate-700 px-4 py-2 flex items-center justify-between">
        <h1 className="text-lg font-bold text-white">🎞️ Recorded videos</h1>
        <Link href="/" className="text-sm text-dash-cyan hover:underline">← Live stream</Link>
      </header>

      <div className="bg-dash-panel border-b border-slate-700 px-4 py-2">
        <div className="text-xs text-slate-400 space-y-1">
          <p><strong className="text-white">All event types are now downloadable:</strong> motion, ding, doorbell_motion, doorbell_motion_detected, on_demand</p>
          <p className="text-slate-500">Using alternative Ring API VOD method for on_demand recordings.</p>
          <p className="text-slate-500"><strong className="text-white">Severity badges:</strong> Green (0-3), Yellow (4-6), Orange (7-8), Red (9-10). Name files as level-XX-name.mp4 to set severity.</p>
        </div>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* Player */}
        <div className="flex-1 p-4">
          <div className="bg-black rounded-xl aspect-video flex items-center justify-center overflow-hidden">
            {c.current ? (
              <video
                key={c.current.url}
                src={c.current.url}
                controls
                autoPlay
                playsInline
                onEnded={onEnded}
                className="w-full h-full object-contain"
              />
            ) : (
              <p className="text-slate-500 text-sm">Pick a number below to play a video.</p>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <label className="text-slate-300">Play video #</label>
            <input
              type="number"
              min={1}
              value={goTo}
              onChange={(e) => setGoTo(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && playNumber()}
              className="w-20 px-2 py-1 rounded bg-dash-card text-white"
            />
            <button onClick={playNumber} className="px-4 py-1.5 rounded bg-dash-cyan text-black font-bold hover:bg-cyan-300">
              ▶ Play
            </button>
            <button onClick={playAll} disabled={!sorted.length} className="px-4 py-1.5 rounded bg-slate-600 text-white disabled:opacity-40">
              ⏭ Play all in order
            </button>
            {playingAll && (
              <button onClick={stopAll} className="px-3 py-1.5 rounded bg-red-700 text-white">■ Stop queue</button>
            )}
            <span className="ml-auto text-slate-400">
              Clip length{' '}
              <input
                type="number"
                min={5}
                max={900}
                value={c.seconds}
                onChange={(e) => c.setSeconds(Math.max(5, Math.min(900, Number(e.target.value) || 15)))}
                className="w-16 px-2 py-1 rounded bg-dash-card text-white"
              />{' '}
              s
            </span>
          </div>

          {c.clipLoading && <p className="mt-2 text-xs text-slate-400">Downloading clip from Ring…</p>}
          {c.current && (
            <p className="mt-2 text-xs text-slate-400">
              Now playing #{currentLabel} · {c.current.clip.eventType} · {new Date(c.current.clip.startMs).toLocaleString()}
            </p>
          )}
          {c.error && (
            <div className="mt-2 p-3 bg-red-900/30 border border-red-700 rounded">
              <p className="text-sm text-red-300">{c.error}</p>
            </div>
          )}
        </div>

        {/* List */}
        <aside className="lg:w-96 bg-dash-panel border-l border-slate-700 p-3 overflow-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-wide text-slate-400">
              {c.loading ? 'Loading…' : `${sorted.length} video${sorted.length === 1 ? '' : 's'}`}
            </span>
            <div className="flex gap-2">
              <button 
                onClick={() => setShowOnlyDownloadable(!showOnlyDownloadable)}
                className={`text-xs ${showOnlyDownloadable ? 'text-dash-cyan' : 'text-slate-400'} hover:underline`}
              >
                {showOnlyDownloadable ? 'Show all' : 'Only downloadable'}
              </button>
              <button onClick={c.load} className="text-xs text-dash-cyan hover:underline">Refresh</button>
            </div>
          </div>

          {!c.loading && !c.clips.length && !c.error && (
            <p className="text-sm text-slate-500">
              No events found for this camera. Ring only keeps clips for periods it recorded.
            </p>
          )}

          {!c.loading && c.clips.length > 0 && showOnlyDownloadable && sorted.length === 0 && (
            <p className="text-sm text-slate-500 mb-2">
              No downloadable clips found. Trigger motion or doorbell events to generate downloadable clips.
            </p>
          )}

          {!c.loading && c.clips.length > 0 && !showOnlyDownloadable && (
            <p className="text-xs text-slate-500 mb-2">
              💡 Tip: Only automatic events (motion, doorbell) are downloadable. Manually triggered recordings (on_demand) are not downloadable via Ring API.
            </p>
          )}

          <ul className="space-y-1">
            {sorted.map((clip) => {
              const n = c.labels[clip.id]
              const isCurrent = c.current?.clip.id === clip.id
              const isDownloadable = clip.downloadable !== false
              const severity = (clip as any).severity
              return (
                <li
                  key={clip.id}
                  className={`flex items-center gap-2 p-2 rounded ${isCurrent ? 'bg-slate-600' : 'bg-dash-card'} ${!isDownloadable ? 'opacity-60' : ''}`}
                >
                  <input
                    key={`${clip.id}-${n}`}
                    type="number"
                    min={1}
                    defaultValue={n}
                    title="Change this number to relabel the video"
                    onBlur={(e) => commitLabel(clip.id, e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    className={`w-14 px-1 py-1 rounded bg-dash-dark text-white text-center ${dupes[n] > 1 ? 'ring-2 ring-red-500' : ''}`}
                  />
                  {severity !== undefined && (
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-bold text-white ${getSeverityColor(severity)}`}
                      title={`Severity level: ${severity}`}
                    >
                      {getSeverityLabel(severity)}
                    </span>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{clip.eventType}</p>
                    <p className="text-xs text-slate-400">{new Date(clip.startMs).toLocaleString()}</p>
                  </div>
                  <button
                    onClick={() => {
                      stopAll()
                      c.play(clip)
                    }}
                    className="px-2 py-1 rounded text-xs font-bold bg-dash-cyan text-black"
                  >
                    ▶
                  </button>
                </li>
              )
            })}
          </ul>
          {Object.values(dupes).some((v) => v > 1) && (
            <p className="mt-2 text-xs text-red-400">Red box = two videos share a number. Only the first is played by number.</p>
          )}
        </aside>
      </div>
    </div>
  )
}
