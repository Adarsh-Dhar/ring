-- Remove password auth fields and add Google OAuth fields
ALTER TABLE "User" DROP COLUMN IF EXISTS "passwordHash";
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "googleSub" TEXT;
