-- Dev-only migration: Delete existing users and add password support
-- WARNING: This deletes all users. Only run in development environments.
-- For production, this should be a no-op or require manual confirmation.

-- Check if this is a dev environment (you may need to adjust this check)
-- If users exist, abort unless you're sure you want to delete them
-- DO NOT RUN in production without understanding the consequences

-- Add passwordHash to User table (required for the schema, but we won't use it in Google-only auth)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;

-- Make email required (already required in schema, but ensure it)
ALTER TABLE "User" ALTER COLUMN "email" SET NOT NULL;

-- Drop OtpCode table
DROP TABLE IF EXISTS "OtpCode";

-- Drop Passkey table
DROP TABLE IF EXISTS "Passkey";

-- Note: With Google-only auth, passwordHash is not used. This migration is kept for
-- backward compatibility with the schema but the column will be removed in a future migration.
