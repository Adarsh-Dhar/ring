'use client'

import { useState, useRef } from 'react'
import { extractFrames, validateFramesSize } from './extractFrames'

interface VideoUploadProps {
  device: string
  onUploadComplete?: () => void
}

export default function VideoUpload({ device, onUploadComplete }: VideoUploadProps) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [extracting, setExtracting] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  const MAX_SIZE_MB = 50
  const MAX_DURATION_SEC = 30

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (!selected) return

    setError(null)

    // Check file type
    if (!selected.type.startsWith('video/')) {
      setError('Please select a video file (MP4 or WebM)')
      return
    }

    // Check file size
    const sizeMB = selected.size / (1024 * 1024)
    if (sizeMB > MAX_SIZE_MB) {
      setError(`File too large. Maximum ${MAX_SIZE_MB} MB.`)
      return
    }

    setFile(selected)

    // Create preview URL
    const url = URL.createObjectURL(selected)
    setPreview(url)

    // Check duration
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      if (video.duration > MAX_DURATION_SEC) {
        setError(`Video too long. Maximum ${MAX_DURATION_SEC} seconds.`)
        setFile(null)
        setPreview(null)
      } else {
        setDuration(video.duration)
      }
    }
    video.src = url
  }

  const handleUpload = async () => {
    if (!file) return

    setUploading(true)
    setError(null)
    setProgress(0)

    try {
      // Extract frames for AI description
      setExtracting(true)
      const frames = await extractFrames(file)
      if (!validateFramesSize(frames)) {
        setError('Frames too large. Max 1.5 MB total.')
        setExtracting(false)
        setUploading(false)
        return
      }
      setExtracting(false)

      // Upload video
      const response = await fetch(`/api/sim/videos?device=${device}`, {
        method: 'POST',
        body: file,
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Upload failed')
      }

      // Save frames for auto-description on future rings
      try {
        await fetch(`/api/sim/videos/frames?device=${device}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ frames }),
        })
      } catch (e) {
        console.warn('Failed to save frames:', e)
        // Non-fatal: video upload succeeded, frames are optional
      }

      setProgress(100)
      setFile(null)
      setPreview(null)
      setDuration(null)
      onUploadComplete?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
      setExtracting(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Delete this video?')) return

    try {
      const response = await fetch(`/api/sim/videos?device=${device}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Delete failed')
      }

      onUploadComplete?.()
    } catch (e) {
      setError('Failed to delete video')
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="file"
          accept="video/mp4,video/webm"
          onChange={handleFileSelect}
          disabled={uploading}
          className="text-xs text-slate-400"
        />
        {file && (
          <button
            onClick={handleUpload}
            disabled={uploading || !!error}
            className="rounded-lg bg-cyan-600 px-3 py-1 text-xs font-semibold hover:bg-cyan-500 disabled:opacity-40"
          >
            {extracting ? 'Extracting frames…' : uploading ? `Uploading ${progress}%` : 'Upload'}
          </button>
        )}
        {!file && (
          <button
            onClick={handleDelete}
            className="rounded-lg bg-red-700 px-3 py-1 text-xs hover:bg-red-600"
          >
            Delete
          </button>
        )}
      </div>

      {preview && (
        <div className="mt-2">
          <video
            ref={videoRef}
            src={preview}
            controls
            className="w-full rounded-lg bg-black"
            style={{ maxHeight: '200px' }}
          />
          <p className="mt-1 text-xs text-slate-400">
            {file?.name} ({((file?.size ?? 0) / (1024 * 1024)).toFixed(2)} MB)
            {duration !== null && ` · ${duration.toFixed(1)}s`}
          </p>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      <p className="text-xs text-slate-500">
        Max {MAX_SIZE_MB} MB, {MAX_DURATION_SEC} seconds. MP4 or WebM.
      </p>
    </div>
  )
}
