# Doorbell Helper

A calm doorbell assistant for a person who lives alone with an intellectual disability or autism. When someone rings, a trusted helper is alerted, can see the door via Ring live video, and tells the resident in plain words whether it is safe to open. If the first helper does not answer, the alert escalates by push and SMS.

Built on the Ring Partner API (webhooks for events, WHEP for live video). Next.js 15, Prisma/Postgres, web-push, Twilio SMS.

## Features

- **Multi-household support**: Manage multiple residents/households from a single installation
- **Escalation chain**: Ask helpers in order, one at a time, with configurable timeout
- **Expected/recurring visits**: Scheduled visits (doctor, cleaner, physio) get quieter notifications and longer timeouts
- **Night lock**: The resident screen always says "do not open" during quiet hours
- **SMS and web push**: Helpers are notified via SMS and/or browser push notifications
- **Helper management**: Add, approve, reorder, and revoke helpers from a setup page
- **Recurring visit management**: Schedule regular visits with flexible repeat patterns
- **Database persistence**: All data stored in PostgreSQL
- **Ring integration**: Real Ring device integration for doorbell events and live video
- **Secure authentication**: Email/phone OTP login with household scoping
- **Device pairing**: Resident devices pair via 6-digit codes

## Prerequisites

- Node.js 20+
- npm (the lockfile is package-lock.json)
- PostgreSQL 17 (required)
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
TOKEN_ENC_KEY=your-32-byte-base64url-encoded-key
APP_URL=https://doorbell.example.com
DATABASE_URL=postgresql://doorbell:devpassword@localhost:5433/doorbell
```

Generate TOKEN_ENC_KEY:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

### Ring Partner API (Required)

```env
RING_HMAC_KEY=your-webhook-signing-key
RING_CLIENT_ID=your-client-id
RING_CLIENT_SECRET=your-client-secret
RING_TRIGGER_EVENTS=button_press
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
# For Twilio trial accounts: use a predefined template name (e.g., "sms_appointment_reminders")
# The template name is sent in the Body parameter
# Leave empty for production accounts (allows custom message bodies)
TWILIO_TEMPLATE_NAME=
```

**Twilio Template Setup (for trial accounts):**

Twilio trial accounts require using predefined message templates instead of custom message bodies:

1. Go to Twilio Console → Messaging → Try it out → Send a message
2. Find your approved template name (e.g., "sms_appointment_reminders")
3. Set it as `TWILIO_TEMPLATE_NAME` in your environment
4. The app will send this template name in the `Body` parameter when sending SMS
5. For production accounts, leave `TWILIO_TEMPLATE_NAME` empty to use custom message bodies

### Optional Variables

```env
# Escalation and check-in settings
ESCALATION_SECONDS=30
CHECKIN_HOUR=10
CHECKIN_GRACE_MIN=60
EMERGENCY_NUMBER=112

# Recurring visits
EXPECTED_TIMEOUT_SECONDS=60
RECURRING_GRACE_MIN=15
```

## Database Setup

Start PostgreSQL with Docker:

```bash
docker-compose -f docker-compose.postgres.yml up -d
```

Run database migrations:

```bash
npm run db:generate
npm run db:migrate
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

### OAuth Flow Setup

1. Set up your Ring Partner account at developer.amazon.com/ring
2. Configure your webhook URL: `https://your-app.com/api/webhook`
3. Set `RING_HMAC_KEY` from your Ring partner settings
4. Configure OAuth redirect URL: `https://your-app.com/api/ring/link`
5. Configure token exchange URL: `https://your-app.com/api/ring/token`
6. In the app settings, go to Ring connection and follow the OAuth flow

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

### Authentication
- `/api/auth/send-otp` - Send OTP code for login
- `/api/auth/verify-otp` - Verify OTP and create session
- `/api/auth/select-household` - Select household (for multi-household users)
- `/api/session` - Get current session or pair resident device

### Household Management (Guardian only)
- `/api/household` - GET/POST for household settings, quiet hours, timeout, device pairing
- `/api/household/members` - GET/POST for member management (invite, remove, reorder, consent)

### Doorbell Operations
- `/api/doorbell/state` - GET the current doorbell state (cases, helpers, device status, recurring visits)
- `/api/doorbell/ack` - POST to acknowledge that a helper is responding to a case
- `/api/doorbell/answer` - POST to answer a case (safe to open / do not open)
- `/api/doorbell/confirm` - POST to confirm an expected visitor
- `/api/doorbell/sos` - POST to trigger an SOS from the resident screen
- `/api/doorbell/checkin` - POST for resident check-in (periodic "I'm alive" signal)
- `/api/doorbell/expected` - GET/POST/DELETE for expected visits
- `/api/doorbell/recurring` - GET/POST/PATCH/DELETE for recurring visit management
- `/api/doorbell/history` - GET case history

### Ring Integration
- `/api/ring/token` - POST for Ring OAuth token exchange (server-to-server)
- `/api/ring/link` - GET for Ring OAuth callback
- `/api/ring/live` - POST/DELETE for WHEP live video streaming

### Other
- `/api/webhook` - POST for Ring webhook events (motion detection, doorbell press, device offline, etc.)
- `/api/push/subscribe` - POST/DELETE for web push subscription management
- `/api/health` - GET for health/readiness status

## Pages

### `/login`
Login page with email/phone OTP authentication.

### `/pair`
Resident device pairing page (enter 6-digit code).

### `/setup` (Guardian only)
Setup page for managing household settings, members, quiet hours, timeout, and recurring visits.

### `/helper`
Helper dashboard showing current cases, live camera feed, and action buttons.

### `/resident`
Resident screen for doorbell events and SOS.

## Architecture

- **Multi-household**: Each household has isolated state, members, and Ring connections
- **State management**: Per-household in-memory store (`lib/doorbell/store.ts`) with lazy loading from PostgreSQL
- **Database**: PostgreSQL for all persistence (users, households, memberships, cases, visits, devices)
- **Time handling**: Per-household time zone for recurring visit scheduling
- **Escalation**: Timeout-based escalation through member chain with configurable timeout
- **Notifications**: SMS via Twilio, web push via VAPID
- **Authentication**: JWT-based session tokens with household scoping and epoch-based revocation
- **Ring integration**: Per-household Ring connections with encrypted token storage, WHEP live streaming
- **Device pairing**: 6-digit code-based resident device authentication

## Vercel Deployment

### Prerequisites

- Vercel account
- Vercel Postgres (or external PostgreSQL)
- Ring Partner API credentials
- Twilio account
- VAPID keys

### Deployment Steps

1. **Push your code to GitHub**

2. **Import project in Vercel**
   - Go to Vercel dashboard → Add New → Project
   - Import your GitHub repository
   - Configure build settings (defaults should work for Next.js)

3. **Set up Vercel Postgres**
   - In Vercel dashboard → Storage → Create Database
   - Choose "Postgres"
   - Copy the `POSTGRES_URL_NON_POOLING` connection string

4. **Configure Environment Variables**

   In Vercel project settings → Environment Variables, add:

   ```env
   # Required
   AUTH_SECRET=<generate with: openssl rand -hex 32>
   TOKEN_ENC_KEY=<generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))">
   APP_URL=https://your-project.vercel.app
   DATABASE_URL=${POSTGRES_URL_NON_POOLING}

   # Ring Partner API
   RING_HMAC_KEY=<your webhook signing key>
   RING_CLIENT_ID=<your client ID>
   RING_CLIENT_SECRET=<your client secret>
   RING_TRIGGER_EVENTS=button_press

   # Notifications
   NEXT_PUBLIC_VAPID_PUBLIC_KEY=<your VAPID public key>
   VAPID_PRIVATE_KEY=<your VAPID private key>
   VAPID_SUBJECT=mailto:you@example.com
   TWILIO_ACCOUNT_SID=<your Twilio SID>
   TWILIO_AUTH_TOKEN=<your Twilio token>
   TWILIO_FROM=<your Twilio phone number>
   TWILIO_TEMPLATE_NAME=<for trial accounts only, e.g., "sms_appointment_reminders">

   # Optional
   ESCALATION_SECONDS=30
   CHECKIN_HOUR=10
   CHECKIN_GRACE_MIN=60
   EMERGENCY_NUMBER=112
   NEXT_PUBLIC_SPEECH_LANG=en-IN
   EXPECTED_TIMEOUT_SECONDS=60
   RECURRING_GRACE_MIN=15
   ```

5. **Deploy**
   - Click "Deploy"
   - Wait for deployment to complete
   - Note your Vercel URL (e.g., `https://your-project.vercel.app`)

6. **Configure Ring Partner API**

   In Ring Developer Console (developer.amazon.com/ring), configure your app:

   **Required URLs:**
   - **Account Link URL**: `https://your-project.vercel.app/api/ring/link`
   - **App Homepage URL**: `https://your-project.vercel.app/`
   - **Token Exchange URL**: `https://your-project.vercel.app/api/ring/token`
   - **Webhook URL**: `https://your-project.vercel.app/api/webhook`

   **Get Your Ring Credentials:**
   1. Go to Ring Developer Console
   2. Copy your client ID and client secret
   3. Generate a webhook signing key (HMAC key)

   **Set Environment Variables:**
   ```env
   RING_HMAC_KEY=<your webhook signing key>
   RING_CLIENT_ID=<your client ID>
   RING_CLIENT_SECRET=<your client secret>
   RING_TRIGGER_EVENTS=button_press
   ```

   **Connect Ring Account:**
   1. After deployment, log in as a guardian
   2. Go to the Setup page
   3. Click "Connect Ring Account"
   4. Follow the OAuth flow to authorize the app
   5. The Ring connection will be linked to your household

### Important Notes for Vercel

**⚠️ File Storage Won't Work**
- Vercel is serverless - file-based storage (`DATA_DIR`) won't persist across deployments
- **You MUST use PostgreSQL** for all persistence in production
- The app automatically uses PostgreSQL when `DATABASE_URL` is set
- If `DATABASE_URL` is missing, the app will fall back to file storage (which will lose data on redeploy)

**Ring Webhook URL**
- Your `APP_URL` must be the public Vercel URL with HTTPS
- Ring requires HTTPS for webhook endpoints
- Example: `https://your-project.vercel.app`

**Twilio Template**
- For Twilio trial accounts, you must use `TWILIO_TEMPLATE_NAME`
- Find your approved template name in Twilio Console → Messaging → Try it out
- Set it as the template name (e.g., "sms_appointment_reminders")
- For production accounts, leave `TWILIO_TEMPLATE_NAME` empty

**Database Persistence**
- All helpers, cases, recurring visits, and settings are stored in PostgreSQL
- Vercel Postgres provides persistent storage across deployments
- Ensure `DATABASE_URL` is set to `${POSTGRES_URL_NON_POOLING}` for best performance

## Security Notes

- The `.env.local` file contains sensitive credentials and should never be committed
- Exposed credentials (Ring, Twilio, VAPID, auth) should be rotated
- Helper sign-in links are single-use tokens tied to helper epochs
- Webhook signatures are verified using `RING_HMAC_KEY`
- Night lock prevents opening during quiet hours regardless of helper approval
- All notification delivery requires real credentials (no mock/simulation mode)

## License

MIT
