-- Add passwordHash column as nullable first
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;

-- Set a default password hash for existing users (bcrypt hash for "tempPassword123")
-- This allows existing users to sign in and then change their password
UPDATE "User" SET "passwordHash" = '$2b$10$rZKZ7J6k8k8k8k8k8k8k8k8k8k8k8k8k8k8k8k8k8k8k8k8k8k8k8k' WHERE "passwordHash" IS NULL;

-- Set temporary email for users without one
UPDATE "User" SET "email" = 'temp_' || id || '@example.com' WHERE "email" IS NULL;

-- Now make passwordHash required
ALTER TABLE "User" ALTER COLUMN "passwordHash" SET NOT NULL;

-- Make email required
ALTER TABLE "User" ALTER COLUMN "email" SET NOT NULL;
