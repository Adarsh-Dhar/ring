/**
 * Camera capture utilities for Ring video streams
 */

export function captureFrame(video: HTMLVideoElement | null): string | null {
  if (!video || video.readyState < 2) return null

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  // Resize to 640px width while maintaining aspect ratio
  const scale = 640 / video.videoWidth
  canvas.width = 640
  canvas.height = video.videoHeight * scale

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1]
}

export async function captureBurst(
  video: HTMLVideoElement | null,
  count: number = 4,
  intervalMs: number = 700
): Promise<string[]> {
  const frames: string[] = []
  
  for (let i = 0; i < count; i++) {
    const frame = captureFrame(video)
    if (frame) frames.push(frame)
    if (i < count - 1) await new Promise(r => setTimeout(r, intervalMs))
  }
  
  return frames
}

export function recordClip(video: HTMLVideoElement, seconds = 10): Promise<Blob> {
  const stream = video.srcObject as MediaStream | null
  if (!stream) return Promise.reject(new Error('Start the stream first'))

  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    .find((m) => MediaRecorder.isTypeSupported(m))
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
  const chunks: Blob[] = []

  return new Promise((resolve, reject) => {
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    rec.onerror = () => reject(new Error('Recording failed'))
    rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || 'video/webm' }))
    rec.start()
    setTimeout(() => rec.state !== 'inactive' && rec.stop(), seconds * 1000)
  })
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export async function discoverRingDevice(): Promise<string | null> {
  try {
    const res = await fetch('/api/ring/devices')
    const data = await res.json()
    if (data.devices && data.devices.length > 0) {
      return data.devices[0].id
    }
    return null
  } catch (error) {
    console.error('Failed to discover device:', error)
    return null
  }
}
