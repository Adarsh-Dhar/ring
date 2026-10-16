/**
 * Simulator video storage - now using storage abstraction.
 * This file provides convenience functions that use the configured storage backend.
 */

import { getStorage, type VideoMetadata } from './storage'
import { sanitiseDevice } from './utils'

const storage = getStorage()

// Re-export device validation for API routes
export { sanitiseDevice }

/**
 * Save a video file for a household's device.
 */
export async function saveVideo(
  householdId: string,
  device: string,
  buffer: Buffer
): Promise<void> {
  const metadata: VideoMetadata = {
    size: buffer.length,
    mtime: Date.now(),
    contentType: 'video/mp4',
  }
  await storage.saveVideo(householdId, device, buffer, metadata)
}

/**
 * Read a video file for a household's device.
 */
export async function readVideo(householdId: string, device: string): Promise<Buffer | null> {
  return storage.readVideo(householdId, device)
}

/**
 * Get file stats for a video.
 */
export async function statVideo(householdId: string, device: string): Promise<VideoMetadata | null> {
  return storage.statVideo(householdId, device)
}

/**
 * Delete a video file for a household's device.
 */
export async function deleteVideo(householdId: string, device: string): Promise<void> {
  await storage.deleteVideo(householdId, device)
}

/**
 * List all videos for a household.
 */
export async function listVideos(householdId: string): Promise<Array<{ device: string; size: number; mtime: number; contentType: string }>> {
  const videos = await storage.listVideos(householdId)
  return videos.map(v => ({
    device: v.device,
    size: v.metadata.size,
    mtime: v.metadata.mtime,
    contentType: v.metadata.contentType,
  }))
}

/**
 * Save extracted frames for a device.
 */
export async function saveFrames(householdId: string, device: string, frames: string[]): Promise<void> {
  await storage.saveFrames(householdId, device, frames)
}

/**
 * Read extracted frames for a device.
 */
export async function readFrames(householdId: string, device: string): Promise<string[] | null> {
  return storage.readFrames(householdId, device)
}

