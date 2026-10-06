-- Migration 0013: Auth hardening
-- This migration adds critical security fixes for authentication

-- Create unique index on googleSub (if not exists)
CREATE UNIQUE INDEX IF NOT EXISTS "User_googleSub_key" ON "User"("googleSub");

-- Add createdAt to ResidentDevice with default
ALTER TABLE "ResidentDevice" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Drop NOT NULL constraint on pairingCodeHash
ALTER TABLE "ResidentDevice" ALTER COLUMN "pairingCodeHash" DROP NOT NULL;

-- Drop old unique index on V2Device (Postgres treats NULLs as distinct, so it never enforced "one active device")
DROP INDEX IF EXISTS "V2Device_householdId_kind_revokedAt_key";

-- Create partial index for V2Device to enforce one active device per kind per household
CREATE UNIQUE INDEX "V2Device_one_active_per_kind" ON "V2Device"("householdId","kind") WHERE "revokedAt" IS NULL;
