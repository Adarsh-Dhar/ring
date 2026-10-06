-- Add sessionVersion to User for session revocation
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 1;
