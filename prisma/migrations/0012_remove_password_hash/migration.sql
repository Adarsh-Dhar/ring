-- Remove passwordHash column (Google-only auth)
ALTER TABLE "User" DROP COLUMN IF EXISTS "passwordHash";
