# Roles: resident, helpers, visitors

The guardian role has been removed. What used to be guardian-only is now available to every helper.

## Model
- **Resident**: exactly one per workspace. A paired device (no login). Pairing a new device deletes every earlier resident device, and creating a new pairing code deletes unused older codes.
- **Helper**: many per workspace, all equal. Google sign-in. `Membership.role` is always `helper`.
- **Visitor**: planned (request link, pass, expected or recurring visit) or unplanned (just rings).

## What changed
- `authorize(req, 'guardian')` became `authorize(req, 'helper')` everywhere; the `'guardian'` value is gone from `lib/guard.ts`, `lib/db/memberships.ts`, `lib/device/registry.ts`.
- `POST /api/household` `create` now takes `helperName`, `helperPhone`, `helperEmail` (was `guardian*`). An account is no longer limited to one workspace.
- Invites are always helper invites. Existing helpers approve new helpers.
- `POST /api/workspace/[id]/leave`: a helper can leave unless they are the last approved helper.
- Members `remove`, `revoke` and `consent` refuse to drop the last approved helper.
- `GET /api/workspace/[id]/dashboard` no longer auto-creates a membership for someone whose name matches the resident.
- Removed `/select-role` and the "Resident View / Helper View" switch. Google sign-in goes to `/select-workspace`; `/create-workspace` asks for the resident's name and the helper's own details.
- Weekly digest push, calendar checks for planned visits, and face enrol/delete now involve every helper.
- Migration `20261021000000_remove_guardian_role`: converts guardian memberships, invites and devices to `helper`, sets the `Membership.role` default to `helper`, and keeps only the most recently seen paired resident device per workspace.

## Behaviour to be aware of
- Every helper can now remove other helpers, change Ring and notice settings, and reorder the contact chain. If you want some actions limited (for example only the helper who created the workspace), that needs a new flag; it is deliberately not here.
- One resident is enforced in application code (pairing flow), not by a database constraint.
