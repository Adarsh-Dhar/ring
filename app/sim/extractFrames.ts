/**
 * Extract frames from a video file in the browser.
 * Returns base64-encoded JPEG frames with timestamps.
 */

const MAX_WIDTH = 640
const JPEG_QUALITY = 0.7
const NUM_FRAMES = 6

export interface ExtractedFrame {
  dataUrl: string
  timestamp: number // seconds into the video
}

export async function extractFrames(videoFile: File): Promise<string[]> {
  const result = await extractFramesWithTimestamps(videoFile)
  return result.map(f => f.dataUrl)
}

export async function extractFramesWithTimestamps(videoFile: File): Promise<ExtractedFrame[]> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'auto'
    video.muted = true
    video.playsInline = true

    const url = URL.createObjectURL(videoFile)
    video.src = url

    video.onloadedmetadata = () => {
      const duration = video.duration
      
      // Validate duration
      if (!isFinite(duration) || duration === 0 || duration < 0) {
        URL.revokeObjectURL(url)
        reject(new Error('Invalid video duration'))
        return
      }

      const frames: ExtractedFrame[] = []
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')

      if (!ctx) {
        URL.revokeObjectURL(url)
        reject(new Error('Could not get canvas context'))
        return
      }

      // Calculate scale to fit within MAX_WIDTH
      const scale = Math.min(1, MAX_WIDTH / video.videoWidth)
      canvas.width = video.videoWidth * scale
      canvas.height = video.videoHeight * scale

      if (canvas.width === 0 || canvas.height === 0) {
        URL.revokeObjectURL(url)
        reject(new Error('Invalid video dimensions'))
        return
      }

      let frameIndex = 0

      const captureFrame = () => {
        if (frameIndex >= NUM_FRAMES) {
          URL.revokeObjectURL(url)
          resolve(frames)
          return
        }

        // Calculate time for this frame (evenly spaced)
        const time = (duration / (NUM_FRAMES + 1)) * (frameIndex + 1)
        video.currentTime = time
      }

      video.onseeked = () => {
        try {
          // Draw current frame to canvas
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

          // Export as JPEG
          const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
          frames.push({
            dataUrl,
            timestamp: video.currentTime,
          })

          frameIndex++
          captureFrame()
        } catch (e) {
          URL.revokeObjectURL(url)
          reject(new Error(`Failed to extract frame ${frameIndex + 1}`))
        }
      }

      video.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error('Video loading failed'))
      }

      // Start capturing
      captureFrame()
    }

    video.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Video loading failed'))
    }
  })
}

/**
 * Check if the total size of frames is within limits.
 * Server limits: 500 KB per frame, 3 MB total.
 */
export function validateFramesSize(frames: string[]): boolean {
  const MAX_FRAME_SIZE = 500_000 // 500 KB per frame
  const MAX_TOTAL_SIZE = 3_000_000 // 3 MB total
  
  for (const frame of frames) {
    // Base64 encoded size is roughly 4/3 of binary size
    const binarySize = (frame.length * 3) / 4
    if (binarySize > MAX_FRAME_SIZE) {
      return false
    }
  }
  
  let totalSize = 0
  for (const frame of frames) {
    const binarySize = (frame.length * 3) / 4
    totalSize += binarySize
  }
  return totalSize < MAX_TOTAL_SIZE
}
