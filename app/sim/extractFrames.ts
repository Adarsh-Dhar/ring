/**
 * Extract frames from a video file in the browser.
 * Returns base64-encoded JPEG frames.
 */

const MAX_WIDTH = 640
const JPEG_QUALITY = 0.7
const NUM_FRAMES = 6

export async function extractFrames(videoFile: File): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'auto'
    video.muted = true
    video.playsInline = true

    const url = URL.createObjectURL(videoFile)
    video.src = url

    video.onloadedmetadata = () => {
      const duration = video.duration
      const frames: string[] = []
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
        // Draw current frame to canvas
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

        // Export as JPEG
        const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
        frames.push(dataUrl)

        frameIndex++
        captureFrame()
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
 * Check if the total size of frames is within limits (approx 1.5 MB).
 */
export function validateFramesSize(frames: string[]): boolean {
  let totalSize = 0
  for (const frame of frames) {
    // Base64 encoded size is roughly 4/3 of binary size
    const binarySize = (frame.length * 3) / 4
    totalSize += binarySize
  }
  return totalSize < 1.5 * 1024 * 1024 // 1.5 MB
}
