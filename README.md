# Doorbell Helper

A calm doorbell assistant for a person who lives alone with an intellectual disability or autism. When someone rings, a trusted helper is alerted, can see the door via Ring live video, and tells the resident in plain words whether it is safe to open. If the first helper does not answer, the alert escalates by push and SMS.

Built on the Ring Partner API (webhooks for events, WHEP for live video). Next.js 15, Prisma/Postgres (optional), web-push, Twilio SMS.

## Features

- **Escalation chain**: Ask helpers in order, one at a time, with configurable timeout
- **Expected/recurring visits**: Scheduled visits (doctor, cleaner, physio) get quieter notifications and longer timeouts
- **Night lock**: The resident screen always says "do not open" during quiet hours
- **SMS and web push**: Helpers are notified via SMS and/or browser push notifications
- **Helper management**: Add, approve, reorder, and revoke helpers from a setup page
- **Recurring visit management**: Schedule regular visits with flexible repeat patterns
- **Database persistence**: Helpers stored in PostgreSQL (optional, falls back to state file)
- **Ring integration**: Real Ring device integration for doorbell events and live video

## Prerequisites

- Node.js 20+
- pnpm or npm
- PostgreSQL 17 (optional, for helper persistence)
- Docker (optional, for PostgreSQL)
- Ring Partner API access
- Twilio account (for SMS)
- VAPID keys (for web push)

## Installation

```bash
npm install
```

## Environment Variables

Copy `.env.example` to `.env.local` and configure:

```bash
cp .env.example .env.local
```

### Required Variables

```env
AUTH_SECRET=your-random-secret-at-least-32-chars
ADMIN_PIN=your-guardian-pin
RESIDENT_TZ=Asia/Kolkata
RESIDENT_NAME=ResidentName
APP_URL=https://doorbell.example.com
```

### Ring Partner API (Required)

```env
RING_HMAC_KEY=your-webhook-signing-key
RING_ACCOUNT_ID=ava1.ring.account.XXXX
RING_TRIGGER_EVENTS=button_press
RING_REFRESH_TOKEN=your-refresh-token
RING_CLIENT_ID=your-client-id
RING_CLIENT_SECRET=your-client-secret
```

### Notifications (Required)

```env
# Web push - generate with: npm run gen:vapid
NEXT_PUBLIC_VAPID_PUBLIC_KEY=your-vapid-public-key
VAPID_PRIVATE_KEY=your-vapid-private-key
VAPID_SUBJECT=mailto:you@example.com

# Twilio SMS
TWILIO_ACCOUNT_SID=your-account-sid
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_FROM=+15551234567
```

### Optional Variables

```env
# PostgreSQL for helper persistence
DATABASE_URL=postgresql://doorbell:devpassword@localhost:5433/doorbell

# Escalation and check-in settings
ESCALATION_SECONDS=30
CHECKIN_HOUR=10
CHECKIN_GRACE_MIN=60
EMERGENCY_NUMBER=112

# Recurring visits
EXPECTED_TIMEOUT_SECONDS=60
RECURRING_GRACE_MIN=15

# Storage
DATA_DIR=./data
```

## PostgreSQL (Optional)

Start PostgreSQL with Docker:

```bash
docker-compose -f docker-compose.postgres.yml up -d
```

Run database migrations:

```bash
npm run db:generate
npm run db:push
```

## Running the App

Development mode:

```bash
npm run dev
```

Production build:

```bash
npm run build
npm start
```

## Ring Integration

### Webhook Setup

1. Set up your Ring Partner account at developer.amazon.com/ring
2. Configure your webhook URL: `https://your-app.com/api/webhook`
3. Set `RING_HMAC_KEY` from your Ring partner settings
4. Add your Ring account ID to `RING_ACCOUNT_ID`

### Live Video

The app uses Ring's WHEP (WebRTC-HTTP Egress Protocol) for live video:
- Helpers can view the door when the resident presses SOS
- Video-only (no audio, per Ring's limitations)
- Session limits: 30s (battery) / 60s (wired) enforced by Ring
- Ring's mandatory watermark is displayed

## Testing

```bash
# Type checking
npm run typecheck

# Run tests
npm test
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

### `/api/ring/live`
POST/DELETE for WHEP live video streaming.

### `/api/health`
GET for health/readiness status (includes database loading state).

## Pages

### `/setup`
Admin setup page for managing helpers, quiet hours, timeout, and recurring visits. Requires ADMIN_PIN.

### `/helper`
Helper dashboard showing current cases, live camera feed, and action buttons.

### `/resident`
Resident screen for doorbell events and SOS.

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
- All notification delivery requires real credentials (no mock/simulation mode)

## License

MIT
