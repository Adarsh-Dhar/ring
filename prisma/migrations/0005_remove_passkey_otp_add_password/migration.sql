-- Delete existing users (dev environment - they'll need to sign up again with email/password)
DELETE FROM "User";

-- Add passwordHash to User table (required)
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT NOT NULL;

-- Make email required
ALTER TABLE "User" ALTER COLUMN "email" SET NOT NULL;

-- Drop OtpCode table
DROP TABLE IF EXISTS "OtpCode";

-- Drop Passkey table
DROP TABLE IF EXISTS "Passkey";
