-- Section 8: case lifecycle (open, helper_review, visitor_left, closed).
-- `status` stays the doorbell answer flow; `lifecycle` is the visitor episode.
ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "lifecycle" TEXT NOT NULL DEFAULT 'open';
ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "visitorLeftAt" TIMESTAMP(3);
ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "lastActivityAt" TIMESTAMP(3);
UPDATE "Case" SET "lastActivityAt" = COALESCE("lastEventAt", "createdAt") WHERE "lastActivityAt" IS NULL;
ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3);
ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "closedBy" TEXT;
ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "outcome" TEXT;
ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "closeReason" TEXT;
ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "possibleNewVisitorAt" TIMESTAMP(3);
ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "splitFromId" TEXT;
CREATE INDEX IF NOT EXISTS "Case_householdId_lifecycle_idx" ON "Case"("householdId", "lifecycle");

-- Resident-set quiet period (pilot default 10 minutes) and look-back window (pilot default 24 hours).
ALTER TABLE "Household" ADD COLUMN IF NOT EXISTS "quietPeriodMin" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "Household" ADD COLUMN IF NOT EXISTS "priorLookbackHours" INTEGER NOT NULL DEFAULT 24;

-- Cases that already finished the doorbell answer flow are closed now, so an old case cannot absorb a new visitor's event.
UPDATE "Case" SET "lifecycle" = 'closed', "closedAt" = COALESCE("resolvedAt", "createdAt"), "closedBy" = 'system', "closeReason" = 'migration'
  WHERE "status" <> 'waiting' AND "closedAt" IS NULL;

-- Labelled correction data for the validation tests (section 12).
CREATE TABLE IF NOT EXISTS "CorrectionLabel" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "obsId" TEXT,
    "code" TEXT,
    "action" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,
    "scoreBefore" INTEGER,
    "scoreAfter" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CorrectionLabel_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CorrectionLabel_caseId_idx" ON "CorrectionLabel"("caseId");
CREATE INDEX IF NOT EXISTS "CorrectionLabel_householdId_createdAt_idx" ON "CorrectionLabel"("householdId", "createdAt");
