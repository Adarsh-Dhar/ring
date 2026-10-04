# Security Considerations

This document outlines security considerations, known limitations, and deployment requirements for the Doorbell Helper application.

## Critical Deployment Requirements

### ⚠️ X-Forwarded-For Spoofing Vulnerability

**Issue**: The application uses `X-Forwarded-For` header for IP-based rate limiting. In development mode (when the Next.js dev server is exposed directly), this header can be spoofed by attackers to bypass rate limits.

**Mitigation**: In production, the application MUST be behind a reverse proxy (Caddy) that:
1. Terminates TLS
2. Sets the real client IP in `X-Forwarded-For`
3. Cannot be bypassed by client headers

**Deployment Architecture**:
```
Internet → Caddy (TLS termination, X-Forwarded-For) → Next.js App
```

**Do NOT**:
- Expose the Next.js dev server directly to the internet
- Use `ALLOW_UNSIGNED_WEBHOOK=1` in production
- Skip the Caddy reverse proxy layer

**Caddy Configuration**:
The provided `docker-compose.yml` includes Caddy with proper configuration. Ensure:
- The Caddy service is running
- All traffic goes through Caddy on port 443
- The Next.js app is only accessible via Caddy (not on port 3000 directly)

### Webhook Signature Verification

- **Development**: Set `ALLOW_UNSIGNED_WEBHOOK=1` in `.env.local` to bypass signature checks
- **Production**: NEVER set `ALLOW_UNSIGNED_WEBHOOK=1`. The webhook endpoint will reject unsigned requests and return 503 if `RING_HMAC_KEY` is not set
- The timestamp age check (5-minute window) prevents replay attacks with old signed requests

### Database Security

- All Ring OAuth tokens are encrypted at rest using AES-256-GCM
- Face recognition descriptors are stored encrypted
- Photos are never stored permanently (only temporarily during pending approval)
- Ensure `TOKEN_ENC_KEY` is a strong 32-byte random value

## Security Headers

The application includes the following security headers via `next.config.js`:

- `X-Frame-Options: DENY` - Prevents clickjacking
- `X-Content-Type-Options: nosniff` - Prevents MIME type sniffing
- `X-XSS-Protection: 1; mode=block` - XSS protection
- `Referrer-Policy: strict-origin-when-cross-origin` - Controls referrer information
- `Content-Security-Policy` - Restricts resource loading (tightened in production)

## Rate Limiting

### Implementation
- In-memory rate limiting (resets on server restart)
- IP-based limits using `X-Forwarded-For` (see vulnerability note above)
- Per-code OTP limits (persisted in database)

### Limits
- OTP verify: 5 attempts per IP per 10 minutes, 10 global attempts per code
- OTP send: 10 per IP per 10 minutes, 5 per user per 10 minutes
- Resident pairing: 5 attempts per IP per 10 minutes, 10 global attempts per code
- Visit requests: Configurable via environment variables

## Authentication & Authorization

### Token Security
- JWT-like tokens signed with HS256 using `AUTH_SECRET`
- Token expiration is REQUIRED (tokens without `exp` claim are rejected)
- Epoch-based revocation: bumping `residentEpoch` or `tokenEpoch` invalidates all issued tokens
- Constant-time signature comparison to prevent timing attacks

### Role-Based Access Control
- Guardian: Full access to household settings, member management
- Helper: Can answer cases, view history, limited settings
- Resident: View-only, confirm door open, SOS, check-in
- Cross-household isolation: All DB queries scoped to `session.householdId`

### Session Security
- HttpOnly, Secure, SameSite cookies
- Device cookie for resident screens (separate from helper session)
- Middleware checks for valid JWT shape before page load

## Known Limitations

### Single-Process Architecture
- State is kept in memory per process
- Horizontal scaling is NOT supported
- Restarting the server preserves state from database (load on startup)
- Rate limits reset on restart (use database-backed limits if this is a concern)

### Face Recognition
- Spoofable with photos (intentionally designed as evidence-only)
- Never auto-opens doors based on face match
- Helper must always confirm before "safe" answer
- Photos erased after approval decision

### In-Memory Rate Limiting
- Resets on server restart
- Acceptable for single-process deployment
- Consider Redis-backed rate limiting if horizontal scaling is needed

## Secret Scanning

The repository includes secret scanning:

### Pre-commit Hook
Run `scripts/scan-secrets.sh` as a pre-commit hook to catch secrets before commit.

### GitHub Actions
The `.github/workflows/secret-scan.yml` workflow runs TruffleHog and Gitleaks on all pushes and PRs.

### Patterns Checked
- Stripe API keys
- Twilio credentials
- AWS access keys
- Generic API keys
- JWT tokens
- Application-specific secrets (AUTH_SECRET, TOKEN_ENC_KEY, etc.)

## Security Testing

### Built-in Tests
Run the test suite:
```bash
npm test
```

Key security tests:
- `tests/isolation.test.ts` - Cross-household IDOR protection
- `tests/auth.test.ts` - Authentication flow
- `tests/hardening.test.ts` - Input validation and sanitization

### Manual Testing
```bash
npm run manual-tests  # Requires RING_HMAC_KEY and server running
npm run stress       # Webhook flood testing
npm run load-test    # Load testing (section 13)
```

### External Scanning
Run OWASP ZAP baseline:
```bash
docker run -t zaproxy/zap-stable zap-baseline.py -t http://host.docker.internal:3000
```

## Security Audits

### Recommended Regular Audits
1. Review and rotate `AUTH_SECRET` and `TOKEN_ENC_KEY`
2. Audit household memberships and revoke unused accounts
3. Review Ring OAuth tokens and rotate if compromised
4. Check Twilio API usage for anomalies
5. Monitor health endpoint for database connectivity issues

### Incident Response
If a security incident is suspected:
1. Immediately bump `residentEpoch` to invalidate all resident sessions
2. Bump `tokenEpoch` for compromised helpers
3. Rotate `AUTH_SECRET` (requires all users to re-authenticate)
4. Rotate `RING_HMAC_KEY` (re-link Ring accounts)
5. Review access logs and audit trails

## Compliance Notes

### Data Retention
- Face embeddings: 30 days (configurable via `FACE_RETENTION_DAYS`)
- Case history: 200 cases per household (capped)
- Webhook events: Deduped by request_id, no explicit retention limit
- Visit requests: Configurable TTL (default 48 hours)

### Privacy
- No photos stored permanently
- Face descriptors encrypted
- SMS delivery via Twilio (check their privacy policy)
- Email delivery via Resend (check their privacy policy)

## Contact

For security issues, please contact the maintainers through the appropriate channel (do not open public issues for security vulnerabilities).
