# Doorbell Helper

A Next.js application for a vulnerable resident. Helpers receive doorbell alerts and make safety decisions, with support for regular/recurring visitors, escalation chains, and SMS/web push notifications.

## Overview

The resident's phone or tablet shows a simple screen when the doorbell rings. Helpers receive alerts and can view a camera feed, confirm it's safe to open, or escalate to the next helper in the chain.

## Safety Model

Regular/recurring visitors are handled on a separate, lighter track but **never auto-approve**. The resident or a helper must always confirm before the screen says "safe to open."

## Features

- **Escalation chain**: Ask helpers in order, one at a time, with configurable timeout
- **Expected/recurring visits**: Scheduled visits (doctor, cleaner, physio) get quieter notifications and longer timeouts
- **Night lock**: The resident screen always says "do not open" during quiet hours
- **SMS and web push**: Helpers are notified via SMS and/or browser push notifications
- **Helper management**: Add, approve, reorder, and revoke helpers from a setup page
- **Recurring visit management**: Schedule regular visits with flexible repeat patterns
- **Database persistence**: Helpers stored in PostgreSQL (optional, falls back to state file)
- **Ring integration**: Optional Ring device integration for real doorbell events and live video

## Development Setup

### Prerequisites

- Node.js 20+
- pnpm 8+
- PostgreSQL 17 (optional, for helper persistence)
- Docker (optional, for PostgreSQL)

### Installation

```bash
pnpm install
```

### Environment Variables

Copy `.env.example` to `.env.local` and configure:

```bash
cp .env.example .env.local
```

Required variables:

```env
AUTH_SECRET=some-random-secret-at-least-32-chars
ADMIN_PIN=12345678
RESIDENT_NAME=ResidentName
RESIDENT_TZ=Asia/Kolkata
APP_URL=http://localhost:3000
```

Optional variables:

```env
# PostgreSQL for helper persistence
DATABASE_URL=postgresql://doorbell:devpassword@localhost:5433/doorbell

# Ring integration (optional)
RING_HMAC_KEY=your-webhook-signing-key
RING_ACCESS_TOKEN=your-access-token
RING_REFRESH_TOKEN=your-refresh-token
RING_CLIENT_ID=your-client-id
RING_CLIENT_SECRET=your-client-secret
RING_API_BASE=https://api.amazonvision.com
RING_TOKEN_URL=https://oauth.ring.com/oauth/token

# Twilio for SMS (optional)
TWILIO_ACCOUNT_SID=your-account-sid
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+15551234567

# VAPID for web push (optional, run npm run gen:vapid to generate)
VAPID_PUBLIC_KEY=your-vapid-public-key
VAPID_PRIVATE_KEY=your-vapid-private-key
```

### PostgreSQL (Optional)

Start PostgreSQL with Docker:

```bash
docker-compose -f docker-compose.postgres.yml up -d
```

Run database migrations:

```bash
pnpm exec prisma generate
pnpm exec prisma db push
```

### Running the App

Development mode:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000)

Production build:

```bash
pnpm build
pnpm start
```

## Ring Simulator

The app includes a Ring simulator for development without a physical Ring device. The simulator exercises the real webhook, authentication, escalation, device-health, Ring API, live-view, and notification paths as closely as possible.

### Simulator Truth Table

| Part | Status |
|------|--------|
| Event delivery, signatures, retries, duplicates | Simulated, through the real webhook code |
| Ring API: token refresh, device list, status | Simulated; shapes unverified until step 7 |
| Live video | Simulated: local mp4 with Ring's session limit and watermark. Real WebRTC/WHEP code exists (`LiveView.tsx`, `/api/ring/live`) but has never run against Ring |
| Web push | Real once VAPID keys are set |
| SMS | Real only with `SMS_LIVE=1` and an allow-listed number |
| Escalation, check-in, quiet hours, recurring visits | Real code, driven by the simulated clock |

### Known Gaps

- The fake WHEP endpoint is not a real WebRTC server
- The real WebRTC path is untested against an actual Ring device
- `ring-sandbox` is not used
- `/sim` and `CameraFeed` were type-checked but not thoroughly browser-tested
- Simulated time does not affect webhook idempotency or fake-server token expiry
- The fake Ring response shapes are copied from what the existing `client.ts` expects and remain unverified against official Ring docs or a real device
- Real Twilio, real web push, and the fake server retry loop against a failing app were not fully tested

### Running the Simulator

1. Enable simulation in `.env.local`:

```env
ENABLE_SIM=1
ALLOW_UNSIGNED_WEBHOOK=1
ALLOW_DEV_AUTH=1
LOCAL_VIDEO=1
VIDEOS_DIR=./videos
```

2. Start the fake Ring server (optional, for fake API responses):

```bash
pnpm run sim:ring
```

3. Start the app with simulation enabled:

```bash
pnpm run dev:sim
```

4. Open the simulator UI at [http://localhost:3000/sim](http://localhost:3000)

### Simulator Features

- **Signed webhooks**: Simulates Ring webhook delivery with HMAC signatures
- **Device offline**: Simulates device offline state through webhook events
- **Simulated clock**: Advance time to trigger escalation and recurring-visit behavior
- **Fake Ring API**: Mock endpoints for device list, status, and token refresh
- **Simulated live view**: Local MP4 clips with Ring-like session limits
- **Notification outbox**: Capture simulated push/SMS deliveries for inspection

### Simulator Scripts

```bash
# Run fake Ring server
pnpm run sim:ring

# Record real Ring responses (for documenting API shapes)
pnpm run record:ring

# Generate VAPID keys for web push
pnpm run gen:vapid

# Run app with simulation enabled
pnpm run dev:sim
```

## Testing

```bash
# Run all tests
pnpm test

# Type checking
pnpm typecheck

# Build
pnpm build
```

## API Endpoints

### `/api/setup` (admin only)

GET/POST for helper management, quiet hours, timeout configuration, and sign-in link generation.

### `/api/doorbell/state`

GET the current doorbell state (cases, helpers, device status, recurring visits).

### `/api/doorbell/ack`

POST to acknowledge that a helper is responding to a case.

### `/api/doorbell/answer`

POST to answer a case (safe to open / do not open).

### `/api/doorbell/confirm`

POST to confirm an expected visitor.

### `/api/doorbell/sos`

POST to trigger an SOS from the resident screen.

### `/api/doorbell/checkin`

POST for helper check-in (periodic "I'm alive" signal).

### `/api/doorbell/recurring`

GET/POST/PATCH/DELETE for recurring visit management.

### `/api/webhook`

POST for Ring webhook events (motion detection, doorbell press, device offline, etc.).

### `/api/sim`

POST for simulator controls (trigger events, advance time, reset state).

### `/api/health`

GET for health/readiness status (includes database loading state).

## Pages

### `/setup`

Admin setup page for managing helpers, quiet hours, timeout, and recurring visits. Requires ADMIN_PIN.

### `/helper`

Helper dashboard showing current cases, camera feed, and action buttons.

### `/resident`

Resident screen for doorbell events and SOS.

### `/sim`

Simulator UI for development and testing.

## Architecture

- **State management**: Synchronous in-memory store (`lib/doorbell/store.ts`) with persistence to PostgreSQL (helpers) and state file (cases, recurring visits, settings)
- **Time handling**: Resident time zone (`RESIDENT_TZ`) for recurring visit scheduling
- **Escalation**: Timeout-based escalation through helper chain with configurable timeout
- **Notifications**: SMS via Twilio, web push via VAPID
- **Authentication**: HMAC token-based auth for helpers and resident
- **Ring integration**: Webhook signature verification, Ring API client, WHEP live streaming

## Security Notes

- The `.env.local` file contains sensitive credentials and should never be committed
- Exposed credentials (Ring, Twilio, VAPID, auth) should be rotated
- Helper sign-in links are single-use tokens tied to helper epochs
- Webhook signatures are verified using `RING_HMAC_KEY`
- Night lock prevents opening during quiet hours regardless of helper approval

## License

MIT
