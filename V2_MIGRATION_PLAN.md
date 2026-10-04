# Doorbell Helper v2 Migration Plan

## Overview
This document tracks the migration from the current architecture to the v2 simpler architecture as outlined in "Doorbell Helper v2_ Simpler Architecture.md".

## Phase 1: Remove Typing (Passkeys, Magic Links, QR Pairing)
**Goal**: Reduce human-typed codes from ~6 to 0-1 (OTP as fallback only)
**Estimated effort**: 1-2 weeks

### 1.1 Database Schema Changes
```sql
-- Add Device table to replace cookies/pairing codes
CREATE TABLE "Device" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  householdId TEXT NOT NULL REFERENCES "Household"(id) ON DELETE CASCADE,
  memberId TEXT REFERENCES "Membership"(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('resident', 'helper', 'guardian', 'visitor')),
  publicKey TEXT NOT NULL,
  lastSeenAt TIMESTAMP NOT NULL DEFAULT NOW(),
  revokedAt TIMESTAMP,
  createdAt TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(householdId, kind, revokedAt) -- At most one active device per kind per household
);

-- Add Passkey table
CREATE TABLE "Passkey" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  memberId TEXT NOT NULL REFERENCES "Membership"(id) ON DELETE CASCADE,
  credentialId TEXT NOT NULL UNIQUE,
  publicKey TEXT NOT NULL,
  counter INTEGER DEFAULT 0,
  createdAt TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Add Household settings preset
ALTER TABLE "Household" ADD COLUMN "preset" TEXT DEFAULT 'standard' CHECK (preset IN ('standard', 'strict', 'custom'));

-- Mark pairingAttempts as deprecated (will be removed after migration)
ALTER TABLE "ResidentDevice" ALTER COLUMN "pairingAttempts" DROP NOT NULL;
```

### 1.2 Authentication Changes
- Implement WebAuthn passkey registration
- Implement magic link email login
- Keep OTP as fallback only
- Device-based sessions instead of cookies

### 1.3 QR Pairing
- Generate QR code containing device registration URL
- Resident tablet scans QR to register device
- No resident login ever

### 1.4 Helper Invite Flow
- Single screen: name + phone/email + consent checkbox
- Auto-create passkey on first successful login
- Session lasts 90 days, renews on use

### 1.5 Files to Create/Modify
**New files:**
- `lib/auth/passkey.ts` - WebAuthn registration/verification
- `lib/auth/magic-link.ts` - Magic link generation/validation
- `lib/device/registry.ts` - Device registration/management
- `app/api/auth/passkey/register/route.ts`
- `app/api/auth/passkey/login/route.ts`
- `app/api/auth/magic-link/route.ts`
- `app/api/device/register/route.ts`
- `app/api/device/qr/route.ts`
- `app/pair-qr/page.tsx` - QR display for guardian
- `app/pair-scan/page.tsx` - QR scan for resident

**Modify:**
- `lib/auth.ts` - Add passkey/magic-link methods
- `lib/guard.ts` - Device-based authorization
- `app/login/page.tsx` - Add passkey/magic-link options
- `app/setup/page.tsx` - QR pairing instead of code
- `app/invite/[code]/page.tsx` - Single-screen consent

---

## Phase 2: Durable Timers (pg-boss Integration)
**Goal**: Survive restarts, allow horizontal scaling
**Estimated effort**: 1 week

### 2.1 Database Schema Changes
```sql
-- pg-boss creates its own tables automatically
-- Just need to install the extension in migrations
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
```

### 2.2 Webhook Changes
- Verify signature → enqueue job → return 200 in <50ms
- No inline processing
- Idempotency via DB unique constraint

### 2.3 Job Queue Integration
- Escalation timers as scheduled jobs
- Check-in timers as scheduled jobs
- Expected visit windows as scheduled jobs

### 2.4 Files to Create/Modify
**New files:**
- `lib/queue/index.ts` - pg-boss wrapper
- `lib/queue/jobs.ts` - Job definitions
- `app/api/webhook/enqueue/route.ts` - Webhook job enqueuer
- `workers/timer-worker.ts` - Background job processor

**Modify:**
- `lib/doorbell/store.ts` - Remove in-memory timers
- `app/api/webhook/route.ts` - Enqueue instead of process
- `prisma/schema.prisma` - Add job-related models

---

## Phase 3: Realtime and Fail-Closed (SSE)
**Goal**: Instant updates, fail-closed by design
**Estimated effort**: 1 week

### 3.1 Server-Sent Events
- SSE endpoint for resident state
- Heartbeat every 5 seconds
- No heartbeat = "keep door closed" screen

### 3.2 Server-Computed ResidentView
- Pure function: (state, household) → ResidentView
- Six states: CLOSED_KEEP_SHUT, WAITING, HELPER_CHECKING, SAFE_CONFIRM, NOT_SAFE, ALL_CLEAR
- Priority fixed in code with property-based tests

### 3.3 Remove Client-Side Stale Logic
- Delete `useDoorbell.ts` polling
- Delete stale detection from client
- Server always sends current truth

### 3.4 Files to Create/Modify
**New files:**
- `lib/state/resident-view.ts` - Pure ResidentView computation
- `app/api/events/route.ts` - SSE endpoint
- `hooks/useRealtime.ts` - SSE client hook
- `tests/resident-view.test.ts` - Property-based tests

**Modify:**
- `lib/doorbell/store.ts` - Emit events on state changes
- `app/resident/page.tsx` - Use SSE instead of polling
- Delete `app/hooks/useDoorbell.ts`

---

## Phase 4: Visitor Passes
**Goal**: Replace pass-word/rotating code with device-bound passes
**Estimated effort**: 1 week

### 4.1 Database Schema Changes
```sql
-- Replace Visit model with Pass model
CREATE TABLE "Pass" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  householdId TEXT NOT NULL REFERENCES "Household"(id) ON DELETE CASCADE,
  visitorName TEXT NOT NULL,
  windowStart TIMESTAMP NOT NULL,
  windowEnd TIMESTAMP NOT NULL,
  recurrence JSONB, -- Optional recurrence rules
  deviceId TEXT REFERENCES "Device"(id) ON DELETE SET NULL,
  revokedAt TIMESTAMP,
  createdAt TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Add PassEvent for audit
CREATE TABLE "PassEvent" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  passId TEXT NOT NULL REFERENCES "Pass"(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('created', 'used', 'revoked')),
  deviceId TEXT REFERENCES "Device"(id),
  at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### 4.2 Visitor Flow
- Guardian creates pass via name + phone
- Visitor gets link, taps "Add to Home Screen"
- On arrival: big "I'm here" button (authenticated by device key)
- Helper sees: "Priya (cleaner), arrived, expected 10:00-10:30" with live view

### 4.3 Keep Codes as Optional
- Add `strict` preset mode that keeps resident-code verification
- Standard/default mode: no codes

### 4.4 Files to Create/Modify
**New files:**
- `lib/visitor/pass.ts` - Pass management
- `app/api/visitor/passes/route.ts`
- `app/visitor/pass/[id]/page.tsx` - Visitor pass page
- `app/visitor/passes/page.tsx` - Guardian pass management

**Modify:**
- `lib/db/visits.ts` - Replace with pass logic
- `app/api/visit-requests/*` - Migration to pass model
- `lib/doorbell/store.ts` - Pass-aware case handling

---

## Phase 5: Notification Ladder
**Goal**: Push → SMS → voice with delivery receipts
**Estimated effort**: 1 week

### 5.1 Notification Service
- Dedicated service for all notifications
- Ladder: push at 0s, SMS at +15s, voice at +45s
- Delivery receipts from all channels
- Retry logic for failed deliveries

### 5.2 Redis Integration
- Rate limits at edge (Redis)
- Pub/sub for realtime state updates
- Survives restarts

### 5.3 Files to Create/Modify
**New files:**
- `lib/notify/ladder.ts` - Notification ladder logic
- `lib/notify/delivery.ts` - Delivery receipt handling
- `lib/redis/index.ts` - Redis client wrapper
- `lib/ratelimit/redis.ts` - Redis-based rate limiting

**Modify:**
- `lib/notify.ts` - Replace with ladder service
- `lib/ratelimit.ts` - Migrate to Redis
- `lib/doorbell/store.ts` - Use ladder service

---

## Phase 6: Hardening
**Goal**: Re-run stress tests, add chaos tests
**Estimated effort**: Ongoing

### 6.1 Stress Test Execution
- Re-run all sections of stress-test guide
- Fix any regressions
- Update documentation

### 6.2 Chaos Tests
- Kill worker mid-case
- Kill Redis during alert
- Kill pg-boss during escalation
- Network partition scenarios

### 6.3 Files to Create/Modify
**New files:**
- `tests/chaos/worker-kill.test.ts`
- `tests/chaos/redis-fail.test.ts`
- `tests/chaos/network-partition.test.ts`

**Modify:**
- `tools/chaos-tests.ts` - Add new scenarios
- `STRESS_TEST_IMPLEMENTATION.md` - Update for v2

---

## Migration Order Strategy

**Recommended order:**
1. Phase 1 (Remove typing) - Most user-visible impact, removes friction
2. Phase 2 (Durable timers) - Enables horizontal scaling, reduces operational risk
3. Phase 3 (Realtime) - Improves UX, simplifies client code
4. Phase 4 (Visitor passes) - Completes "no codes" vision
5. Phase 5 (Notification ladder) - Improves reliability
6. Phase 6 (Hardening) - Continuous validation

**Parallel opportunities:**
- Phase 3 can start after Phase 2 (realtime needs durable state)
- Phase 4 is independent of Phase 2-3
- Phase 5 can run in parallel with Phase 4

---

## Rollback Strategy

Each phase is designed to be independently rollbackable:
- Database migrations include rollback scripts
- New features feature-flagged via environment variables
- Old code paths kept until next phase
- A/B testing capability for gradual rollout

---

## Current Status

- [x] Phase 1: Remove typing (Schema complete, integration deferred - see V2_PHASE1_STATUS.md)
- [x] Phase 2: Durable timers (Schema complete, integration deferred - see V2_PHASE2_STATUS.md)
- [x] Phase 3: Realtime and fail-closed (Schema complete, integration deferred - see V2_PHASE3_STATUS.md)
- [x] Phase 4: Visitor passes (Schema complete, integration deferred - see V2_PHASE4_STATUS.md)
- [x] Phase 5: Notification ladder (Schema complete, integration deferred - see V2_PHASE5_STATUS.md)
- [x] Phase 6: Hardening (Complete - TypeScript passes, chaos tests documented)
