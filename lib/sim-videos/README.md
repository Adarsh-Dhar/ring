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
│   ├── sim-front-door.frames.json
│   ├── sim-back-door.mp4
│   └── sim-back-door.frames.json
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
  saveFrames(householdId: string, device: string, frames: string[]): Promise<void>
  readFrames(householdId: string, device: string): Promise<string[] | null>
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

## AI Frames

Extracted frames for AI analysis are stored alongside videos as JSON files. These are used for automatic AI description when a simulated doorbell event occurs.

### Automatic AI Analysis Path

When a simulated doorbell event occurs:

1. **Event Trigger**: Doorbell press in simulator creates a case
2. **AI Hook**: `lib/ai/hooks.ts` `onDoorEvent()` checks if AI is enabled
3. **Job Enqueue**: If AI enabled, enqueues `AI_DESCRIBE` job via `lib/queue/jobs.ts`
4. **Job Execution**: `lib/ai/workers.ts` worker calls `describeForCase()`
5. **Device Check**: `describeForCase()` checks if device starts with `sim-`
6. **Frame Read**: For sim devices, reads stored frames via `readFrames()`
7. **AI Description**: Sends frames to `describeClip()` which calls the AI model
8. **Result Save**: `setCaseAi()` saves results to the database
9. **Push Notification**: First result triggers helper push notification
10. **Helper UI**: `AiCaseCard` polls and displays the summary

### Required AI Settings

For automatic AI analysis to work:
- `DEMO_MODE=1` (simulator enabled)
- Household AI enabled (`aiEnabled: true` in database)
- Frames stored for the device (uploaded via `/sim`)
- Job queue initialized (pg-boss or inline execution)

### Manual AI Description

You can also manually trigger AI description from `/sim`:
1. Select a video file
2. Click "🎞 Describe video"
3. Frames are extracted and sent to `/api/ai/describe-video`
4. Results appear in the status display

## Testing the Full Flow

To test locally:

1. Start app with `DEMO_MODE=1`
2. Enable AI for your household in `/setup`
3. Go to `/sim` and upload an MP4 for `sim-front-door`
4. Press the doorbell in the simulator
5. Helper should see:
   - Video playback from uploaded clip
   - AI summary appear (after a few seconds)
   - Helper decision controls still work
6. Resident should see normal waiting state

