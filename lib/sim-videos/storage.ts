/**
 * Storage abstraction for simulator videos and frames.
 * This allows switching between local filesystem and cloud storage (S3, Blob, etc.)
 * based on deployment environment.
 */

export interface VideoStorage {
  saveVideo(householdId: string, device: string, buffer: Buffer, metadata: VideoMetadata): Promise<void>
  readVideo(householdId: string, device: string): Promise<Buffer | null>
  statVideo(householdId: string, device: string): Promise<VideoMetadata | null>
  /** Stream bytes [start, end] (inclusive) without loading the whole file. */
  streamVideo(householdId: string, device: string, start: number, end: number): Promise<ReadableStream<Uint8Array> | null>
  deleteVideo(householdId: string, device: string): Promise<void>
  listVideos(householdId: string): Promise<Array<{ device: string; metadata: VideoMetadata }>>
  saveFrames(householdId: string, device: string, frames: string[]): Promise<void>
  readFrames(householdId: string, device: string): Promise<string[] | null>
}

export interface VideoMetadata {
  size: number
  mtime: number
  contentType: string
}

/**
 * Get the storage implementation based on environment.
 * Currently defaults to local filesystem.
 * For production with cloud storage, configure STORAGE_TYPE env var.
 */
export function getStorage(): VideoStorage {
  const storageType = process.env.STORAGE_TYPE || 'local'
  
  if (storageType === 'local') {
    const { LocalVideoStorage } = require('./localVideoStorage')
    return new LocalVideoStorage()
  }
  
  // Future: Add S3, Blob, etc.
  // if (storageType === 's3') {
  //   const { S3VideoStorage } = require('./s3VideoStorage')
  //   return new S3VideoStorage()
  // }
  
  throw new Error(`Unknown storage type: ${storageType}`)
}
