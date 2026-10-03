# Multi-Household Migration Guide

This document describes the changes made and the remaining work to complete the multi-household refactor.

## Completed Changes

### Phase 1: Data Model and Auth ✅
- **Prisma Schema**: Updated with new models (User, Household, Membership, ResidentDevice, RingConnection, Device, Case, ExpectedVisit, RecurringVisit, PushSubscription, WebhookEvent)
- **lib/auth.ts**: Rewritten with new token format (kind, sub, householdId, epoch, exp) and AES-256-GCM encryption for Ring tokens
- **lib/guard.ts**: Rewritten with household scoping, removed admin PIN logic, added device token support
- **Login/Auth Routes**: Added `/api/auth/send-otp`, `/api/auth/verify-otp`, `/api/auth/select-household`, and `/login` page
- **Session Route**: Updated to support device pairing via 6-digit codes

### Phase 2: Ring OAuth Linking ✅
- **Ring Token Route**: Implemented token exchange with Ring, stores encrypted tokens in RingConnection table
- **Ring Link Route**: Implemented OAuth callback handling, binds connection to user's household
- **lib/ring/client.ts**: Rewritten for per-connection token management with caching and refresh locks

### Phase 3: Repository Layer & Store Refactor ✅
- **lib/db/households.ts**: Household and device management functions
- **lib/db/memberships.ts**: Membership management (replaces old helper functions)
- **lib/db/cases.ts**: Case persistence
- **lib/db/visits.ts**: Expected and recurring visit management
- **lib/db/push.ts**: Push subscription management
- **lib/doorbell/notify.ts**: Updated with `pushToMembership` function
- **lib/doorbell/config.ts**: Removed global RESIDENT_TZ, EMERGENCY_NUMBER, HELPERS
- **lib/doorbell/store.ts**: Complete refactor for per-household state with lazy loading from DB

### Phase 4: API Routes ✅
- **Doorbell routes**: All updated with householdId scoping
- **Setup route**: Replaced with `/api/household` and `/api/household/members`
- **Webhook route**: Updated to look up household by Ring account ID
- **Ring live route**: Updated to use per-connection tokens
- **Push subscription**: Updated to scope to membershipId

## Remaining Work

### Phase 5: UI Updates

1. **Landing page** (`app/page.tsx`):
   - Replace dev link page with proper landing
   - Redirect by role after login

2. **New pages**:
   - `/app/onboarding/page.tsx` - create household, connect Ring, invite helpers, pair device
   - `/app/invite/[code]/page.tsx` - accept helper invitation

3. **Setup page** (`app/setup/page.tsx`):
   - Remove PIN prompt and usePin.ts
   - Add Ring connection panel
   - Add members panel
   - Household switcher if multiple

4. **Helper pages** (`app/helper/*`):
   - Add household switcher
   - Scope all API calls to householdId

5. **Resident page** (`app/resident/page.tsx`):
   - Use device token cookie
   - Handle 401 by redirecting to `/pair`

6. **Consent page** (`app/consent/page.tsx`):
   - Tie to membership invite

### Phase 6: Configuration and Tests

1. **Environment variables**:
   - Add: `TOKEN_ENC_KEY` (32-byte base64url)
   - Remove: `ADMIN_PIN`, `SETUP_PIN`, `ALLOW_DEV_AUTH`, `ALLOW_UNSIGNED_WEBHOOK`, `RING_ACCOUNT_ID`, `RING_REFRESH_TOKEN`, `RING_DEVICE_IDS`, `SEED_DEMO_HELPERS`, `DATA_DIR`, `RESIDENT_TZ`, `RESIDENT_NAME`
   - Keep: `RING_CLIENT_ID`, `RING_CLIENT_SECRET`, `RING_HMAC_KEY`
   - Update: `.env.prod.example`, `docker-compose.yml`, README

2. **Migration script**:
   - Create script to migrate existing single-household data to new schema
   - Convert Helper table to User + Membership
   - Convert in-memory state to database records

3. **Tests**:
   - Rewrite `auth.test.ts` for new token format
   - Rewrite `escalation.test.ts` for per-household
   - Rewrite `hardening.test.ts` without PIN logic
   - Delete `helpers-db.test.ts` (use membership tests)
   - Add cross-household isolation tests
   - Add tests for OAuth flow, webhook routing

4. **Tools**:
   - Update `tools/stress.ts`, `tools/manual-tests.ts`, `tools/check-state.ts`

5. **Ops**:
   - Update `scripts/backup.sh` for Postgres only
   - Consider moving scheduler to worker process for multi-instance deployments

## Implementation Priority

The recommended order to complete the remaining work:

1. **Phase 6 (Config)** - Update env vars and run migration
2. **Phase 5 (UI)** - Update pages to work with new API
3. **Phase 6 (Tests)** - Write tests to verify isolation

## Database Migration

Run the Prisma migration after updating the schema:

```bash
npm run db:migrate
```

Then run the data migration script (to be created):

```bash
tsx scripts/migrate-to-multi-household.ts
```

## Testing Strategy

After completing the refactor, test:

1. **Household isolation**: User from household A cannot access household B's data
2. **Token rotation**: Bumping epoch revokes old tokens
3. **Ring connection**: Each household has its own Ring connection
4. **Device pairing**: 6-digit code flow works correctly
5. **Escalation**: Alerts still work per household
6. **Scheduler**: Multiple households' cases are handled independently
