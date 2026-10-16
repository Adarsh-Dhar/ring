'use client'

import { useState, useRef, useEffect } from 'react'
import { extractFrames, validateFramesSize } from './extractFrames'

interface VideoUploadProps {
  device: string
  onUploadComplete?: () => void
}

interface UploadedClip {
  device: string
  size: number
  mtime: number
}

const ALLOWED_MIME_TYPES = ['video/mp4']

export default function VideoUpload({ device, onUploadComplete }: VideoUploadProps) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null) // Track for cleanup
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [uploadedClip, setUploadedClip] = useState<UploadedClip | null>(null)
  const [loadingClip, setLoadingClip] = useState(true)
  const videoRef = useRef<HTMLVideoElement>(null)

  const MAX_SIZE_MB = 50
  const MAX_DURATION_SEC = 30

  // Load existing clip on mount
  useEffect(() => {
    loadExistingClip()
    return () => {
      // Cleanup preview URL on unmount
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
      }
    }
  }, [device])

  const loadExistingClip = async () => {
    setLoadingClip(true)
    try {
      const response = await fetch('/api/sim/videos')
      if (response.ok) {
        const data = await response.json()
        const clip = data.videos?.find((v: UploadedClip) => v.device === device)
        setUploadedClip(clip || null)
      }
    } catch (e) {
      console.error('Failed to load existing clips:', e)
    } finally {
      setLoadingClip(false)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (!selected) return

    setError(null)
    setUploadStatus(null)

    // Validate file type explicitly
    if (!ALLOWED_MIME_TYPES.includes(selected.type)) {
      setError('Please select an MP4 video file')
      // Cleanup if file is rejected
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      if (input) input.value = ''
      return
    }

    // Check file size
    const sizeMB = selected.size / (1024 * 1024)
    if (sizeMB > MAX_SIZE_MB) {
      setError(`File too large. Maximum ${MAX_SIZE_MB} MB.`)
      // Cleanup if file is rejected
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      if (input) input.value = ''
      return
    }

    setFile(selected)

    // Create preview URL and track it for cleanup
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
    }
    const url = URL.createObjectURL(selected)
    setPreviewUrl(url)
    setPreview(url)

    // Check duration
    const video = document.createElement('video')
    video.preload = 'metadata'
    
    const handleMetadata = () => {
      if (video.duration === 0 || !isFinite(video.duration)) {
        setError('Invalid video duration')
        setFile(null)
        setPreview(null)
        if (previewUrl) {
          URL.revokeObjectURL(previewUrl)
          setPreviewUrl(null)
        }
        const input = document.querySelector('input[type="file"]') as HTMLInputElement
        if (input) input.value = ''
        return
      }
      
      if (video.duration > MAX_DURATION_SEC) {
        setError(`Video too long. Maximum ${MAX_DURATION_SEC} seconds.`)
        setFile(null)
        setPreview(null)
        if (previewUrl) {
          URL.revokeObjectURL(previewUrl)
          setPreviewUrl(null)
        }
        const input = document.querySelector('input[type="file"]') as HTMLInputElement
        if (input) input.value = ''
      } else {
        setDuration(video.duration)
      }
    }

    const handleError = () => {
      setError('Could not load video metadata')
      setFile(null)
      setPreview(null)
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
        setPreviewUrl(null)
      }
      const input = document.querySelector('input[type="file"]') as HTMLInputElement
      if (input) input.value = ''
    }

    video.onloadedmetadata = handleMetadata
    video.onerror = handleError
    video.src = url
  }

  const handleUpload = async () => {
    if (!file) return

    setUploading(true)
    setError(null)
    setUploadStatus('Uploading video...')

    try {
      // Upload video with XMLHttpRequest for progress tracking
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100)
            setUploadStatus(`Uploading video... ${percent}%`)
          }
        }

        xhr.onload = async () => {
          if (xhr.status === 200) {
            setUploadStatus('Video uploaded successfully')
            
            // Extract frames for AI description
            setExtracting(true)
            setUploadStatus('Extracting frames for AI...')
            try {
              const frames = await extractFrames(file)
              if (!validateFramesSize(frames)) {
                setError('Frames too large. Max 1.5 MB total. Video uploaded but AI unavailable.')
                setUploadStatus('Video uploaded (AI unavailable)')
              } else {
                // Save frames for auto-description on future rings
                const framesResponse = await fetch(`/api/sim/videos/frames?device=${device}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ frames }),
                })
                
                if (framesResponse.ok) {
                  setUploadStatus('Video uploaded, AI frames saved')
                } else {
                  const data = await framesResponse.json().catch(() => ({}))
                  setError(`Video uploaded, AI frames could not be saved: ${data.error || 'Unknown error'}`)
                  setUploadStatus('Video uploaded (AI frames failed)')
                }
              }
            } catch (e) {
              console.error('Frame extraction failed:', e)
              setError(`Video uploaded, frame extraction failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
              setUploadStatus('Video uploaded (AI unavailable)')
            } finally {
              setExtracting(false)
            }

            // Cleanup
            setFile(null)
            setPreview(null)
            if (previewUrl) {
              URL.revokeObjectURL(previewUrl)
              setPreviewUrl(null)
            }
            setDuration(null)
            await loadExistingClip()
            onUploadComplete?.()
            resolve()
          } else {
            const data = JSON.parse(xhr.responseText)
            reject(new Error(data.error || 'Upload failed'))
          }
        }

        xhr.onerror = () => {
          setError('Network error during upload')
          setUploadStatus(null)
          reject(new Error('Network error'))
        }

        xhr.open('POST', `/api/sim/videos?device=${device}`)
        xhr.send(file)
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
      setUploadStatus(null)
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Delete this video?')) return

    setError(null)
    setUploadStatus('Deleting...')

    try {
      const response = await fetch(`/api/sim/videos?device=${device}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Delete failed')
      }

      setUploadedClip(null)
      setUploadStatus('Video deleted')
      onUploadComplete?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete video')
      setUploadStatus(null)
    }
  }

  const handleCancel = () => {
    setFile(null)
    setPreview(null)
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
    }
    setDuration(null)
    setError(null)
    setUploadStatus(null)
    // Reset file input
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    if (input) input.value = ''
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="file"
          accept="video/mp4"
          onChange={handleFileSelect}
          disabled={uploading}
          className="text-xs text-slate-400"
        />
        {file && (
          <>
            <button
              onClick={handleUpload}
              disabled={uploading || !!error}
              className="rounded-lg bg-cyan-600 px-3 py-1 text-xs font-semibold hover:bg-cyan-500 disabled:opacity-40"
            >
              {extracting ? 'Extracting frames…' : uploading ? uploadStatus : 'Upload'}
            </button>
            <button
              onClick={handleCancel}
              disabled={uploading}
              className="rounded-lg bg-slate-600 px-3 py-1 text-xs hover:bg-slate-500 disabled:opacity-40"
            >
              Cancel
            </button>
          </>
        )}
        {!file && uploadedClip && (
          <button
            onClick={handleDelete}
            disabled={uploading}
            className="rounded-lg bg-red-700 px-3 py-1 text-xs hover:bg-red-600 disabled:opacity-40"
          >
            Delete
          </button>
        )}
      </div>

      {loadingClip && (
        <p className="text-xs text-slate-500">Loading clip status...</p>
      )}

      {!loadingClip && !uploadedClip && !file && (
        <p className="text-xs text-slate-500">No clip uploaded for this device</p>
      )}

      {!loadingClip && uploadedClip && !file && (
        <div className="mt-2 p-2 bg-slate-800 rounded-lg">
          <p className="text-xs text-slate-300">
            Uploaded clip ({(uploadedClip.size / (1024 * 1024)).toFixed(2)} MB)
          </p>
          <video
            src={`/api/sim/videos/${device}`}
            controls
            className="w-full rounded-lg bg-black mt-2"
            style={{ maxHeight: '200px' }}
          />
        </div>
      )}

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

      {uploadStatus && !error && (
        <p className="text-xs text-emerald-400">{uploadStatus}</p>
      )}

      <p className="text-xs text-slate-500">
        Max {MAX_SIZE_MB} MB, {MAX_DURATION_SEC} seconds. MP4 only.
      </p>
    </div>
  )
}
