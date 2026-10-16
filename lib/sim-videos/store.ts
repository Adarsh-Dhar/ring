import fs from 'fs/promises'
import path from 'path'
import { mkdir } from 'fs/promises'

const SIM_VIDEO_DIR = process.env.SIM_VIDEO_DIR || '.data/sim-videos'
const SIM_VIDEO_MAX_MB = parseInt(process.env.SIM_VIDEO_MAX_MB || '50', 10)
const MAX_SIZE_BYTES = SIM_VIDEO_MAX_MB * 1024 * 1024

// Magic bytes for allowed video formats
const MAGIC_BYTES: Record<string, Uint8Array> = {
  mp4: new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]), // ftyp box start
  webm: new Uint8Array([0x1A, 0x45, 0xDF, 0xA3]), // EBML header
}

/**
 * Sanitise device suffix to allow only safe characters.
 * Returns null if invalid.
 */
export function sanitiseDevice(device: string): string | null {
  if (!device || !device.startsWith('sim-')) return null
  const suffix = device.slice(4) // Remove 'sim-' prefix
  if (!/^[a-z0-9-]{1,30}$/.test(suffix)) return null
  return device
}

/**
 * Validate file type by checking magic bytes.
 */
export function validateFileType(buffer: Buffer, type: string): boolean {
  const magic = MAGIC_BYTES[type]
  if (!magic) return false
  for (let i = 0; i < magic.length; i++) {
    if (buffer[i] !== magic[i]) return false
  }
  return true
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
 */
export async function saveVideo(
  householdId: string,
  device: string,
  buffer: Buffer,
  type: 'mp4' | 'webm'
): Promise<void> {
  const sanitised = sanitiseDevice(device)
  if (!sanitised) throw new Error('Invalid device name')

  if (buffer.length > MAX_SIZE_BYTES) {
    throw new Error(`File too large. Maximum ${SIM_VIDEO_MAX_MB} MB.`)
  }

  if (!validateFileType(buffer, type)) {
    throw new Error(`Invalid ${type.toUpperCase()} file`)
  }

  await ensureHouseholdDir(householdId)
  const filePath = getVideoPath(householdId, sanitised)
  await fs.writeFile(filePath, buffer)
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
export async function statVideo(householdId: string, device: string): Promise<{ size: number; mtime: number } | null> {
  const sanitised = sanitiseDevice(device)
  if (!sanitised) return null

  const filePath = getVideoPath(householdId, sanitised)
  try {
    const stats = await fs.stat(filePath)
    return { size: stats.size, mtime: stats.mtimeMs }
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
export async function listVideos(householdId: string): Promise<Array<{ device: string; size: number; mtime: number }>> {
  const dir = path.join(SIM_VIDEO_DIR, householdId)
  try {
    const entries = await fs.readdir(dir)
    const videos: Array<{ device: string; size: number; mtime: number }> = []

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
