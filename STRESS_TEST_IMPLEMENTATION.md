# Stress Test Implementation Summary

This document summarizes the changes made to the Doorbell Helper application to support the comprehensive stress-test guide.

## Overview

The application was already well-implemented for most of the stress-test guide requirements. The following enhancements were made to address critical gaps and improve security posture.

## Changes Made

### 1. Webhook Timestamp Validation (S1 - Security)
**File**: `app/api/webhook/route.ts`

Added timestamp age checking to prevent replay attacks:
- Rejects webhooks with timestamps older than 5 minutes
- Rejects webhooks with timestamps more than 5 minutes in the future (clock skew protection)
- Validates timestamp format before processing

**Test**: Section 4.5 - "Old timestamp (hours ago) - Decide: accepted or rejected?"

### 2. Enhanced OTP Brute Force Protection (S2 - Security)
**File**: `app/api/auth/verify-otp/route.ts`

Implemented multi-layered OTP protection:
- IP-based rate limiting: 5 attempts per IP per 10 minutes
- Per-code global limit: 10 attempts across all IPs before code is permanently locked
- Survives server restarts (attempt counter in database)

**Tests**: Section 6.1 - OTP brute force, 6.5 - Per-code lock after 10 attempts

### 3. Security Headers (S2 - Security)
**File**: `next.config.js`

Added comprehensive security headers:
- `X-Frame-Options: DENY` - Prevents clickjacking
- `X-Content-Type-Options: nosniff` - Prevents MIME type sniffing
- `X-XSS-Protection: 1; mode=block` - XSS protection
- `Referrer-Policy: strict-origin-when-cross-origin` - Controls referrer info
- `Content-Security-Policy` - Tight CSP in production, relaxed in dev

**Test**: Section 14 - Security quick scan

### 4. Postgres Failure Detection (S1 - Safety)
**Files**: 
- `lib/doorbell/store.ts`
- `app/api/health/route.ts`
- `app/hooks/useDoorbell.ts`
- `app/resident/page.tsx`

Implemented database health monitoring:
- Health endpoint now includes `dbHealthy` status
- Tick function checks database connectivity every second
- Resident screen shows "Can't be sure" when database is down
- Health check fails (503) when database is unreachable

**Tests**: Section 5.4 - Stop Postgres mid-case, 5.5 - Restore Postgres

### 5. Connection Lost Detection (S1 - Safety)
**File**: `app/hooks/useDoorbell.ts` (verified existing implementation)

The existing implementation already includes:
- Stale detection after 5 seconds without successful response
- Connection lost screen with "Keep door closed, call helper"
- Re-fetch on visibility change and network reconnection
- No changes needed - implementation verified as correct

**Test**: Section 12.1 - Airplane mode for 30s mid-case

### 6. Load Testing Scripts (S3 - Reliability)
**File**: `tools/load-test.ts`

Created comprehensive load testing tool:
- Test 13.1: Concurrent resident/helper polling (uses autocannon)
- Test 13.2: Webhook burst with multiple households
- Test 13.3: Soak test (8-24 hours with periodic doorbell presses)
- Test 13.4: 100+ households in memory check
- Test 13.5: Slow database simulation (manual)

**Usage**: `npm run load-test <test-type>`

### 7. Secret Scanning (S2 - Security)
**Files**:
- `scripts/scan-secrets.sh` - Pre-commit hook
- `.github/workflows/secret-scan.yml` - GitHub Actions workflow
- `.gitleaks.toml` - Gitleaks configuration

Implemented automated secret detection:
- Pre-commit hook scans staged files for common secret patterns
- GitHub Actions runs TruffleHog and Gitleaks on all PRs
- Checks for: API keys, tokens, passwords, application secrets
- Allowlist for `.env.example` files

**Test**: Section 14 - Security quick scan

### 8. Security Documentation (S2 - Security)
**File**: `SECURITY.md`

Created comprehensive security documentation:
- Critical deployment requirements (Caddy proxy, X-Forwarded-For handling)
- Webhook signature verification requirements
- Database security notes
- Security headers configuration
- Rate limiting implementation details
- Authentication & authorization mechanisms
- Known limitations (single-process, face recognition spoofability)
- Secret scanning setup
- Security testing guidelines
- Compliance notes
- Incident response procedures

### 9. Cross-Household Isolation Tests (S2 - Security)
**File**: `tests/isolation.test.ts`

Expanded test coverage for IDOR protection:
- Household settings route scoping
- Expected visit route isolation
- Member removal scoping
- Face enrollment isolation
- Visit request link protection
- SOS trigger isolation
- Recurring visit isolation

**Test**: Section 6.9 - Cross-household IDOR testing

### 10. Chaos Scenario Scripts (S1/S3 - Safety/Reliability)
**File**: `tools/chaos-tests.ts`

Created chaos scenario test guides:
- Scenario 1: Everything fails (Postgres down + Twilio wrong + push revoked + Ring offline)
- Scenario 2: The long night (quiet hours + expected visit + wrong pass-word)
- Scenario 3: Helper chaos (H1 no answer, H2 safe, H1 not-safe within 5 min)
- Scenario 4: Impersonator (attacker knows visit, gives wrong pass-word twice)
- Scenario 5: Rapid events (ring, SOS, offline, ring within 5s)
- Scenario 6: Restart mid-escalation (kill server while H2 timer running)

**Usage**: `npm run chaos-tests <scenario>`

## Already Implemented (No Changes Needed)

The following features were already well-implemented:

### Core Safety Flow (Section 2)
- Webhook signature verification ✅
- Idempotency via request_id ✅
- Escalation timer with helper chain ✅
- Turn-based answering (409 on wrong turn) ✅
- Case merging for rapid presses ✅
- Night lock enforcement ✅
- Pass-word/code verification ✅

### Planned Visits (Section 7)
- One-off and recurring visits ✅
- Code mode with rotating 3-digit codes ✅
- Pass-word mode ✅
- Grace period windows ✅
- Demotion on wrong pass-word ✅
- Single-use visits ✅

### Face Recognition (Section 9)
- Enrollment with consent ✅
- Encrypted descriptors ✅
- Evidence-only (never auto-opens) ✅
- Photo erasure on decision ✅
- Regular visitor registration ✅

### Notifications (Section 10)
- Web push + SMS ✅
- Failure tracking ✅
- Degraded state detection ✅

### Live Video (Section 11)
- Ring token encryption ✅
- Session management ✅

### Frontend/Accessibility (Section 12)
- Stale detection ✅
- Wake lock ✅
- Screen reader support ✅
- Sound/vibration controls ✅

### Authentication (Section 6)
- Token epoch revocation ✅
- Role-based access control ✅
- Session cookies with security flags ✅
- Middleware protection ✅

## Running the Tests

### Baseline Tests
```bash
npm run typecheck    # TypeScript compilation
npm test            # Unit tests (15 test files)
npm run manual-tests # Manual verification (requires server)
npm run stress      # Webhook flood testing
```

### Load Testing
```bash
npm run load-test polling            # Test 13.1
npm run load-test webhook-burst      # Test 13.2
npm run load-test soak 3600          # Test 13.3 (1 hour)
npm run load-test multi-household    # Test 13.4
npm run load-test slow-db            # Test 13.5 (manual)
```

### Chaos Scenarios
```bash
npm run chaos-tests everything-fails     # Scenario 1
npm run chaos-tests long-night           # Scenario 2
npm run chaos-tests helper-chaos         # Scenario 3
npm run chaos-tests impersonator         # Scenario 4
npm run chaos-tests rapid-events         # Scenario 5
npm run chaos-tests restart-escalation   # Scenario 6
```

### Security Scanning
```bash
# Pre-commit (manual for now)
./scripts/scan-secrets.sh

# GitHub Actions runs automatically on PRs
```

## Deployment Checklist

Before deploying to production:

1. **Security Configuration**
   - [ ] Set strong `AUTH_SECRET` (32+ chars)
   - [ ] Set strong `TOKEN_ENC_KEY` (32 bytes base64url)
   - [ ] Set `RING_HMAC_KEY` from Ring partner onboarding
   - [ ] Configure Twilio credentials
   - [ ] Ensure `ALLOW_UNSIGNED_WEBHOOK` is NOT set
   - [ ] Ensure `DEMO_MODE` is NOT set

2. **Infrastructure**
   - [ ] Deploy behind Caddy reverse proxy
   - [ ] Configure TLS certificates
   - [ ] Ensure Caddy sets real `X-Forwarded-For`
   - [ ] Use Docker Compose for full stack
   - [ ] Configure PostgreSQL with backups

3. **Testing**
   - [ ] Run full test suite: `npm test`
   - [ ] Run typecheck: `npm run typecheck`
   - [ ] Run stress tests: `npm run stress`
   - [ ] Run manual tests: `npm run manual-tests`
   - [ ] Test webhook with real Ring account
   - [ ] Verify database backup/restore

4. **Monitoring**
   - [ ] Monitor `/api/health` endpoint
   - [ ] Set up error tracking (Sentry optional)
   - [ ] Monitor Twilio API usage
   - [ ] Review logs for security events

## Known Limitations

1. **Single-Process Architecture**
   - State is in-memory per process
   - Horizontal scaling not supported
   - Rate limits reset on restart
   - Acceptable for current deployment model

2. **Face Recognition**
   - Spoofable with photos (intentional)
   - Never auto-opens doors
   - Helper must always confirm

3. **X-Forwarded-For**
   - Requires Caddy proxy in production
   - Dev server can be spoofed (documented in SECURITY.md)

## Conclusion

The Doorbell Helper application is now suitable for the comprehensive stress-test guide. All critical S1 (safety) and S2 (security) gaps have been addressed. The application includes:

- ✅ Comprehensive security headers
- ✅ Webhook timestamp validation
- ✅ Enhanced OTP brute force protection
- ✅ Database failure detection
- ✅ Connection lost handling
- ✅ Load testing tools
- ✅ Secret scanning
- ✅ Security documentation
- ✅ Expanded isolation tests
- ✅ Chaos scenario guides

The remaining tests in the stress-test guide can now be executed to verify the system's safety and reliability.
