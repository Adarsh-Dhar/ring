-- Add emergency alert tracking columns to Case model
-- This enables exactly-once emergency alerts across multiple servers and restarts
ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "emergencyAlertedAt" TIMESTAMP;
ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "unconfirmedAlertedAt" TIMESTAMP;
