-- The "guardian" role no longer exists. A workspace has exactly one resident (a paired device),
-- any number of helpers, and visitors (planned and unplanned).
-- Every former guardian keeps full access, now simply as a helper.

UPDATE "Membership" SET "role" = 'helper' WHERE "role" = 'guardian';
UPDATE "Invite"     SET "role" = 'helper' WHERE "role" = 'guardian';
UPDATE "V2Device"   SET "kind" = 'helper' WHERE "kind" = 'guardian';
ALTER TABLE "Membership" ALTER COLUMN "role" SET DEFAULT 'helper';

-- Exactly one resident per workspace: where several resident devices were paired, keep only the most
-- recently seen one. Unused pairing codes (pairingCodeHash set) are left alone.
DELETE FROM "ResidentDevice" r
USING "ResidentDevice" k
WHERE r."householdId" = k."householdId"
  AND r."pairingCodeHash" IS NULL
  AND k."pairingCodeHash" IS NULL
  AND (
    COALESCE(r."lastSeenAt", r."createdAt") < COALESCE(k."lastSeenAt", k."createdAt")
    OR (COALESCE(r."lastSeenAt", r."createdAt") = COALESCE(k."lastSeenAt", k."createdAt") AND r."id" < k."id")
  );
