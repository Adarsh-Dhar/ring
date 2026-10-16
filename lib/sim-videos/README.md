# Simulator Video Storage Configuration

## Overview

The simulator video feature uses a storage abstraction layer that supports multiple backends:
- **Local filesystem** (default): Suitable for local development and self-hosted deployments
- **Cloud storage** (future): S3, Vercel Blob, etc. for serverless deployments

## Local Storage (Default)

For local development and self-hosted environments, videos are stored on the local filesystem.

### Environment Variables

```bash
# Storage type: 'local' (default) or future options like 's3', 'blob'
STORAGE_TYPE=local

# Directory for storing simulator videos (default: .data/sim-videos)
SIM_VIDEO_DIR=.data/sim-videos

# Maximum upload size in MB (default: 50)
SIM_VIDEO_MAX_MB=50

# Demo mode - required for simulator video upload (default: undefined)
DEMO_MODE=1
```

### Docker Configuration

The `docker-compose.yml` includes a volume for persistent storage:

```yaml
volumes:
  sim_videos:
    driver: local

services:
  app:
    volumes:
      - sim_videos:/usr/src/app/.data/sim-videos
```

### File Structure

Videos are stored per household and device:

```
.data/sim-videos/
├── <householdId>/
│   ├── sim-front-door.mp4
│   └── sim-back-door.mp4
```

## Cloud Storage (Future)

For serverless deployments (e.g., Vercel), local filesystem storage is not reliable. To add cloud storage:

1. Implement a new storage class in `lib/sim-videos/s3VideoStorage.ts` (or similar)
2. Implement the `VideoStorage` interface
3. Set `STORAGE_TYPE=s3` (or your chosen backend)
4. Configure credentials via environment variables

### Example: S3 Storage

```bash
STORAGE_TYPE=s3
AWS_S3_BUCKET=your-bucket-name
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
```

## Storage Interface

All storage implementations must implement the `VideoStorage` interface:

```typescript
interface VideoStorage {
  saveVideo(householdId: string, device: string, buffer: Buffer, metadata: VideoMetadata): Promise<void>
  readVideo(householdId: string, device: string): Promise<Buffer | null>
  statVideo(householdId: string, device: string): Promise<VideoMetadata | null>
  deleteVideo(householdId: string, device: string): Promise<void>
  listVideos(householdId: string): Promise<Array<{ device: string; metadata: VideoMetadata }>>
}
```

## Allowed Devices

For security, only specific simulator device IDs are allowed:

- `sim-front-door`
- `sim-back-door`

To add more devices, update the `ALLOWED_DEVICES` set in `lib/sim-videos/localVideoStorage.ts`.

## Video Format

Currently, only MP4 format is supported for MVP simplicity. The UI and storage validate:
- MIME type: `video/mp4`
- Magic bytes: ftyp box signature
- Maximum size: 50 MB (configurable)
- Maximum duration: 30 seconds (client-side validation)

## Testing the Full Flow

To test locally:

1. Start app with `DEMO_MODE=1`
2. Go to `/sim` and upload an MP4 for `sim-front-door`
3. Press the doorbell in the simulator
4. Helper should see:
   - Video playback from uploaded clip
   - Helper decision controls still work
5. Resident should see normal waiting state

