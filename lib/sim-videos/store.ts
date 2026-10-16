import fs from 'fs/promises'
import path from 'path'
import { mkdir } from 'fs/promises'

const SIM_VIDEO_DIR = process.env.SIM_VIDEO_DIR || '.data/sim-videos'
const SIM_VIDEO_MAX_MB = parseInt(process.env.SIM_VIDEO_MAX_MB || '50', 10)
const MAX_SIZE_BYTES = SIM_VIDEO_MAX_MB * 1024 * 1024

// Allowed simulator device IDs
const ALLOWED_DEVICES = new Set(['sim-front-door', 'sim-back-door'])

// Magic bytes for MP4 (ISO Base Media File Format - ftyp box)
const MP4_MAGIC = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70])

/**
 * Validate MP4 format by checking for ftyp box signature.
 * This is more robust than checking a fixed header size.
 */
function validateMP4(buffer: Buffer): boolean {
  if (buffer.length < 12) return false
  
  // Check for ftyp box at any reasonable position (first 1KB)
  const searchEnd = Math.min(buffer.length, 1024)
  const uint8Array = new Uint8Array(buffer)
  for (let i = 0; i < searchEnd - 8; i++) {
    if (uint8Array[i] === 0x66 && uint8Array[i + 1] === 0x74 && uint8Array[i + 2] === 0x79 && uint8Array[i + 3] === 0x70) {
      // Found 'ftyp', validate the box size
      const size = (uint8Array[i - 4] << 24) | (uint8Array[i - 3] << 16) | (uint8Array[i - 2] << 8) | uint8Array[i - 1]
      if (size > 8 && size <= buffer.length - i + 4) {
        return true
      }
    }
  }
  return false
}

/**
 * Detect file format from contents.
 * Returns 'mp4' or null if unknown.
 */
function detectFormat(buffer: Buffer): 'mp4' | null {
  if (validateMP4(buffer)) return 'mp4'
  return null
}

/**
 * Sanitise device suffix to allow only safe characters and ensure it's in the allowlist.
 * Returns null if invalid.
 */
export function sanitiseDevice(device: string): string | null {
  if (!device || !device.startsWith('sim-')) return null
  if (!ALLOWED_DEVICES.has(device)) return null
  return device
}

/**
 * Get the file path for a household's device video.
 */
export function getVideoPath(householdId: string, device: string): string {
  const sanitised = sanitiseDevice(device)
  if (!sanitised) throw new Error('Invalid device name')
  return path.join(SIM_VIDEO_DIR, householdId, `${sanitised}.mp4`)
}

/**
 * Get the frames JSON path for a household's device.
 */
export function getFramesPath(householdId: string, device: string): string {
  const sanitised = sanitiseDevice(device)
  if (!sanitised) throw new Error('Invalid device name')
  return path.join(SIM_VIDEO_DIR, householdId, `${sanitised}.frames.json`)
}

/**
 * Ensure the household directory exists.
 */
async function ensureHouseholdDir(householdId: string): Promise<void> {
  const dir = path.join(SIM_VIDEO_DIR, householdId)
  try {
    await mkdir(dir, { recursive: true })
  } catch (e) {
    // Ignore if directory already exists
    if ((e as any).code !== 'EEXIST') throw e
  }
}

/**
 * Save a video file for a household's device.
 * Currently MP4-only for MVP simplicity.
 */
export async function saveVideo(
  householdId: string,
  device: string,
  buffer: Buffer
): Promise<void> {
  const sanitised = sanitiseDevice(device)
  if (!sanitised) throw new Error('Invalid device name')

  if (buffer.length > MAX_SIZE_BYTES) {
    throw new Error(`File too large. Maximum ${SIM_VIDEO_MAX_MB} MB.`)
  }

  // Validate format
  const format = detectFormat(buffer)
  if (format !== 'mp4') {
    throw new Error('Invalid MP4 file format')
  }

  await ensureHouseholdDir(householdId)
  const filePath = getVideoPath(householdId, sanitised)
  await fs.writeFile(filePath, new Uint8Array(buffer))
}

/**
 * Read a video file for a household's device.
 */
export async function readVideo(householdId: string, device: string): Promise<Buffer | null> {
  const sanitised = sanitiseDevice(device)
  if (!sanitised) return null

  const filePath = getVideoPath(householdId, sanitised)
  try {
    return await fs.readFile(filePath)
  } catch (e) {
    if ((e as any).code === 'ENOENT') return null
    throw e
  }
}

/**
 * Get file stats for a video.
 */
export async function statVideo(householdId: string, device: string): Promise<{ size: number; mtime: number; contentType: string } | null> {
  const sanitised = sanitiseDevice(device)
  if (!sanitised) return null

  const filePath = getVideoPath(householdId, sanitised)
  try {
    const stats = await fs.stat(filePath)
    return { size: stats.size, mtime: stats.mtimeMs, contentType: 'video/mp4' }
  } catch (e) {
    if ((e as any).code === 'ENOENT') return null
    throw e
  }
}

/**
 * Delete a video file for a household's device.
 */
export async function deleteVideo(householdId: string, device: string): Promise<void> {
  const sanitised = sanitiseDevice(device)
  if (!sanitised) throw new Error('Invalid device name')

  const filePath = getVideoPath(householdId, sanitised)
  try {
    await fs.unlink(filePath)
  } catch (e) {
    if ((e as any).code !== 'ENOENT') throw e
  }

  // Also delete frames if they exist
  const framesPath = getFramesPath(householdId, sanitised)
  try {
    await fs.unlink(framesPath)
  } catch (e) {
    if ((e as any).code !== 'ENOENT') throw e
  }
}

/**
 * List all videos for a household.
 */
export async function listVideos(householdId: string): Promise<Array<{ device: string; size: number; mtime: number; contentType: string }>> {
  const dir = path.join(SIM_VIDEO_DIR, householdId)
  try {
    const entries = await fs.readdir(dir)
    const videos: Array<{ device: string; size: number; mtime: number; contentType: string }> = []

    for (const entry of entries) {
      if (entry.endsWith('.mp4')) {
        const device = entry.slice(0, -4) // Remove .mp4
        const stats = await statVideo(householdId, device)
        if (stats) {
          videos.push({ device, ...stats })
        }
      }
    }

    return videos
  } catch (e) {
    if ((e as any).code === 'ENOENT') return []
    throw e
  }
}

/**
 * Save extracted frames for a device.
 */
export async function saveFrames(householdId: string, device: string, frames: string[]): Promise<void> {
  const sanitised = sanitiseDevice(device)
  if (!sanitised) throw new Error('Invalid device name')

  await ensureHouseholdDir(householdId)
  const framesPath = getFramesPath(householdId, sanitised)
  await fs.writeFile(framesPath, JSON.stringify(frames))
}

/**
 * Read extracted frames for a device.
 */
export async function readFrames(householdId: string, device: string): Promise<string[] | null> {
  const sanitised = sanitiseDevice(device)
  if (!sanitised) return null

  const framesPath = getFramesPath(householdId, sanitised)
  try {
    const data = await fs.readFile(framesPath, 'utf-8')
    return JSON.parse(data)
  } catch (e) {
    if ((e as any).code === 'ENOENT') return null
    throw e
  }
}

