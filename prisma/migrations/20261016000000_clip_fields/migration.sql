-- Migration: columns the video describer writes (schema.prisma had them, no earlier migration created them).
-- Idempotent: safe on databases that were created with `prisma db push`.
ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "clipActions"        JSONB   DEFAULT '[]';
ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "clipPeopleCount"    INTEGER DEFAULT 0;
ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "clipApproachedDoor" BOOLEAN DEFAULT false;
