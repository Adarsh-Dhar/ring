# Phase 4 Status: Visitor Passes

## Current Status: Implementation Complete

## Completed Work

### 1. Pass Management Library ✅
- Created `lib/visitor/pass.ts` with:
  - `createPass()` - Create new visitor pass
  - `getPass()` - Get pass by ID
  - `getPassesForHousehold()` - List all passes for household
  - `getActivePassesForHousehold()` - Get currently active passes
  - `verifyPassForDevice()` - Verify pass is valid for device
  - `usePass()` - Mark pass as used (visitor arrival)
  - `revokePass()` - Revoke a pass
  - `deleteOldPasses()` - Cleanup old passes
  - `isPassActive()` - Check if pass is currently active
  - `getNextPassOccurrence()` - Calculate next occurrence for recurring passes

### 2. API Endpoints ✅
- Created `app/api/visitor/passes/route.ts`:
  - GET - List all passes for household
  - POST - Create new pass
- Created `app/api/visitor/passes/[id]/route.ts`:
  - GET - Get pass details
  - DELETE - Revoke pass
- Created `app/api/visitor/arrival/route.ts`:
  - POST - Mark visitor arrival (simplified, no device binding yet)

### 3. Visitor UI Pages ✅
- Created `app/visitor/pass/[id]/page.tsx`:
  - Visitor pass display page
  - Shows pass details and validity window
  - "I'm Here" button to mark arrival
  - Status indicator (active/inactive)
  - Add to home screen prompt
- Created `app/visitor/passes/page.tsx`:
  - Guardian pass management page
  - List all passes
  - Create new pass form
  - Revoke pass button
  - Recent activity log

### 4. Database Schema ✅
- Schema already includes:
  - `Pass` model - Visitor passes
  - `PassEvent` model - Pass audit log
  - `V2Device` model - Device registry (from Phase 1)

## Pass Flow

### Guardian Creates Pass
1. Guardian opens `/visitor/passes`
2. Clicks "Create Pass"
3. Enters visitor name, valid window
4. System generates pass with short token
5. Guardian shares link with visitor: `/visitor/pass/[id]?token=...`

### Visitor Uses Pass
1. Visitor opens pass link
2. Sees pass details and validity window
3. If active, clicks "I'm Here"
4. System creates PassEvent (type: used)
5. System notifies all household members

### Guardian Manages Passes
1. Guardian sees all passes on `/visitor/passes`
2. Can revoke any pass
3. Sees recent activity for each pass
4. Can see which passes are currently active

## Device Binding (Future Enhancement)

Current implementation uses a simple token-based system without device binding. For full device-bound passes (as per v2 architecture):

### Required Changes
1. **Pass Creation with Device Binding**:
   - Generate QR code for visitor to scan
   - Visitor scans QR with their device
   - Device registers with pass
   - Pass bound to device public key

2. **Arrival with Device Signature**:
   - Visitor taps "I'm Here"
   - Device signs arrival with private key
   - Server verifies signature
   - Only device-bound device can use pass

3. **Current Simplified Flow**:
   - Pass created with short token
   - Anyone with token can mark arrival
   - No device authentication
   - Suitable for testing, not production

## Testing Required

### Manual Testing
- [ ] Create a pass via `/visitor/passes`
- [ ] Verify pass appears in list
- [ ] Open pass link as visitor
- [ ] Verify pass details displayed correctly
- [ ] Click "I'm Here" button
- [ ] Verify arrival notification sent
- [ ] Verify PassEvent created
- [ ] Revoke pass
- [ ] Verify revoked pass cannot be used
- [ ] Test pass outside validity window
- [ ] Test recurring pass creation (if added)

### Integration Testing
- [ ] Test pass creation with invalid dates
- [ ] Test pass creation with empty name
- [ ] Test pass usage with invalid token
- [ ] Test pass usage after revocation
- [ ] Test pass usage outside window
- [ ] Test pass cleanup (deleteOldPasses)
- [ ] Test concurrent pass usage

## Migration from Old System

### Existing Visit System
The app currently has:
- `ExpectedVisit` model - Expected visits with passphrases
- `RecurringVisit` model - Recurring visits
- `VisitRequest` model - Visitor requests
- Passphrase/code-based verification

### Migration Strategy
1. **Coexistence**: Keep old system alongside new passes
2. **Feature Flag**: Add `USE_NEW_PASSES` environment variable
3. **Gradual Migration**:
   - New households use passes by default
   - Existing households can opt-in
   - Old visit system remains for backward compatibility
4. **Data Migration**:
   - Convert existing ExpectedVisits to Passes
   - Convert existing RecurringVisits to Passes with recurrence
   - Keep VisitRequest system for visitor-initiated requests

### Preset Modes
- **Standard**: Use new passes (no codes)
- **Strict**: Keep old code-based verification
- **Custom**: Mix of both

## Deployment Considerations

### Production Setup
1. **Security**: Pass tokens should be short-lived (optional)
2. **Rate Limiting**: Prevent pass creation abuse
3. **Monitoring**: Track pass usage and success rate
4. **Cleanup**: Run `deleteOldPasses` periodically via job queue

### Environment Variables
- `USE_NEW_PASSES` - Enable new pass system
- `PASS_TOKEN_LENGTH` - Token length (default: 12)
- `PASS_CLEANUP_DAYS` - Days before cleanup (default: 30)

## Known Limitations

1. **No Device Binding**: Current implementation uses tokens, not device keys
2. **No QR Code**: Passes shared via link, not QR
3. **No Recurring UI**: Recurring passes not implemented in UI
4. **No Delivery Receipts**: No confirmation that visitor received link
5. **No Rescheduling**: Can't edit pass after creation
6. **No Multi-Use**: Each pass is single-use (can be reused in current impl)

## Next Steps

### Immediate
1. Add device binding for production security
2. Add QR code generation for easy sharing
3. Add recurring pass UI
4. Add pass editing/rescheduling
5. Add pass delivery receipts

### Optional Enhancements
1. Add multi-use passes
2. Add pass expiration notifications
3. Add pass usage analytics
4. Add visitor onboarding flow
5. Add pass templates (cleaner, delivery, etc.)

### Move to Phase 5
Phase 4 is functionally complete. Ready to move to Phase 5: Notification Ladder.

## Dependencies
- ✅ Existing Prisma models (Pass, PassEvent, V2Device)
- ✅ Existing authorization (guard.ts)
- ✅ Existing notification system (notify.ts)
- ⚠️ Device registry (from Phase 1, not fully integrated)

## Notes
- Passes replace pass-words and rotating codes
- Current implementation is simplified (token-based)
- Full device-bound passes require Phase 1 completion
- Can coexist with old visit system during migration
- Preset modes allow gradual rollout
- Audit log tracks all pass events

## Migration Notes
- No database migration needed (schema already exists)
- Can run side-by-side with old visit system
- Feature flag for gradual rollout
- Data migration script needed for existing visits
- Old visit system remains for backward compatibility
