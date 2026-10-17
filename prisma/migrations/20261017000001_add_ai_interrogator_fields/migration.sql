-- Add aiInterrogator to Household
ALTER TABLE "Household" ADD COLUMN IF NOT EXISTS "aiInterrogator" BOOLEAN DEFAULT false;

-- Add interrogation fields to Case
ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "interrogationState" TEXT;
ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "interrogationTurns" JSON DEFAULT '[]';
ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "interrogationVerdict" TEXT;
ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "interrogationClaims" JSON;
ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "riskLevel" TEXT;
ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "riskAssessment" JSON;
