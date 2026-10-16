-- Rename greeter to interrogator
ALTER TABLE "Case" RENAME COLUMN "greeterState" TO "interrogationState";
ALTER TABLE "Household" RENAME COLUMN "aiGreeter" TO "aiInterrogator";

-- Add new interrogation columns
ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "interrogationTurns" JSON DEFAULT '[]';
ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "interrogationVerdict" TEXT;
ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "interrogationClaims" JSON;
