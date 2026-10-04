# Phase 1 Status: Remove Typing

## Current Status: Infrastructure Ready, Integration Pending

The v2 database schema and models are in place, but full integration requires careful type compatibility work to avoid breaking existing functionality.

## Completed Work

### 1. Database Schema Changes ✅
- Added `preset` field to `Household` model (standard | strict | custom)
- Created `V2Device` model (replaces cookies, pairing codes, visitor tokens)
- Created `Passkey` model (WebAuthn passkeys)
- Created `Pass` model (visitor passes)
- Created `PassEvent` model (audit log for passes)
- Applied migration to database

### 2. Packages Installed ✅
- `@simplewebauthn/server`
- `@simplewebauthn/types`
- `@simplewebauthn/browser`
- `qrcode`

### 3. Core Implementation Files Created (Disabled Pending Integration)
- `lib/auth/passkey.ts.disabled` - WebAuthn passkey library
- `lib/auth/magic-link.ts.disabled` - Magic link authentication
- `lib/device/registry.ts.disabled` - Device registry and management
- `lib/session/device.ts.disabled` - Device-based session management

### 4. API Endpoints Created (Disabled Pending Integration)
- `app/api/auth/passkey/register/route.ts` - Passkey registration
- `app/api/auth/passkey/login/route.ts` - Passkey login
- `app/api/auth/magic-link/route.ts` - Magic link send/verify
- `app/api/device/register/route.ts` - Device registration
- `app/api/device/qr/route.ts` - QR code generation

### 5. UI Pages Created (Disabled Pending Integration)
- `app/pair-qr/page.tsx` - Guardian QR display
- `app/pair-scan/page.tsx` - Resident QR scan
- `app/invite/[code]/page.tsx` - Single-screen consent

### 6. Authorization Update ✅
- Updated `lib/guard.ts` with `getV2DeviceSession()` function
- Updated `authorize()` to support v2 sessions alongside old sessions
- Maintains backward compatibility

## Integration Work Needed

### TypeScript Compatibility Issues
The new v2 code has TypeScript errors due to:
1. WebAuthn library API changes between versions
2. Prisma model casing (oTPCode vs otpCode)
3. Auth token structure incompatibilities
4. Import path conflicts

### Recommended Integration Approach

1. **Incremental Integration**: Enable one feature at a time
   - Start with magic link (simplest, no WebAuthn complexity)
   - Then QR pairing (no WebAuthn)
   - Finally passkeys (most complex)

2. **Type Fixes Required**:
   - Fix WebAuthn API usage to match installed version
   - Align Prisma model casing
   - Resolve auth token structure conflicts
   - Fix import paths

3. **Feature Flags**:
   - Add `V2_PASSKEYS_ENABLED` environment variable
   - Add `V2_MAGIC_LINK_ENABLED` environment variable
   - Add `V2_QR_PAIRING_ENABLED` environment variable
   - Gradually roll out each feature

4. **Testing Strategy**:
   - Keep existing OTP flow working
   - Test each new auth method in isolation
   - Ensure backward compatibility
   - Add A/B testing capability

## Estimated Time to Complete Phase 1

**Full integration**: 3-5 days of focused development

**If done incrementally**: 1-2 days per feature (magic link → QR pairing → passkeys)

## Dependencies
- ✅ @simplewebauthn/server
- ✅ @simplewebauthn/types
- ✅ @simplewebauthn/browser
- ✅ qrcode

## Notes
- Database schema is ready and migrated
- Core architecture is sound
- Integration work is primarily about fixing TypeScript errors and ensuring smooth coexistence with existing code
- The `.disabled` files can be re-enabled when ready for integration

## Next Steps

1. **Option A**: Fix TypeScript errors and integrate incrementally
2. **Option B**: Continue with Phase 2 (Durable timers) which is independent of Phase 1
3. **Option C**: Create feature flags and enable features one at a time with testing
4. **Option D**: Focus on documentation and migration planning for now
