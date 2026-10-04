-- Migration: Add v2 architecture models
-- Phase 1: Remove typing - Device-based authentication
-- Adds: V2Device, Passkey, Pass, PassEvent models
-- Adds: preset field to Household

-- Add preset field to Household
ALTER TABLE "Household" ADD COLUMN "preset" TEXT DEFAULT 'standard' CHECK ("preset" IN ('standard', 'strict', 'custom'));

-- Create V2Device table (replaces cookies, pairing codes, visitor tokens)
CREATE TABLE "V2Device" (
  id TEXT NOT NULL,
  householdId TEXT NOT NULL,
  memberId TEXT,
  kind TEXT NOT NULL,
  publicKey TEXT NOT NULL,
  lastSeenAt TIMESTAMP NOT NULL DEFAULT NOW(),
  revokedAt TIMESTAMP,
  createdAt TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "V2Device_pkey" PRIMARY KEY (id)
);

-- Create indexes for V2Device
CREATE UNIQUE INDEX "V2Device_householdId_kind_revokedAt_key" ON "V2Device"("householdId", "kind", "revokedAt");
CREATE INDEX "V2Device_householdId_idx" ON "V2Device"("householdId");
CREATE INDEX "V2Device_memberId_idx" ON "V2Device"("memberId");

-- Add foreign key constraints
ALTER TABLE "V2Device" ADD CONSTRAINT "V2Device_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "V2Device" ADD CONSTRAINT "V2Device_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Create Passkey table (WebAuthn)
CREATE TABLE "Passkey" (
  id TEXT NOT NULL,
  memberId TEXT NOT NULL,
  credentialId TEXT NOT NULL,
  publicKey TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  createdAt TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "Passkey_pkey" PRIMARY KEY (id)
);

-- Create indexes for Passkey
CREATE UNIQUE INDEX "Passkey_credentialId_key" ON "Passkey"("credentialId");
CREATE INDEX "Passkey_memberId_idx" ON "Passkey"("memberId");

-- Add foreign key constraint
ALTER TABLE "Passkey" ADD CONSTRAINT "Passkey_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create Pass table (visitor passes)
CREATE TABLE "Pass" (
  id TEXT NOT NULL,
  householdId TEXT NOT NULL,
  visitorName TEXT NOT NULL,
  windowStart TIMESTAMP NOT NULL,
  windowEnd TIMESTAMP NOT NULL,
  recurrence JSONB,
  deviceId TEXT,
  revokedAt TIMESTAMP,
  createdAt TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "Pass_pkey" PRIMARY KEY (id)
);

-- Create indexes for Pass
CREATE INDEX "Pass_householdId_idx" ON "Pass"("householdId");
CREATE INDEX "Pass_windowStart_windowEnd_idx" ON "Pass"("windowStart", "windowEnd");

-- Add foreign key constraints
ALTER TABLE "Pass" ADD CONSTRAINT "Pass_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Pass" ADD CONSTRAINT "Pass_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "V2Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Create PassEvent table (audit log)
CREATE TABLE "PassEvent" (
  id TEXT NOT NULL,
  passId TEXT NOT NULL,
  type TEXT NOT NULL,
  deviceId TEXT,
  at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "PassEvent_pkey" PRIMARY KEY (id)
);

-- Create indexes for PassEvent
CREATE INDEX "PassEvent_passId_idx" ON "PassEvent"("passId");
CREATE INDEX "PassEvent_at_idx" ON "PassEvent"("at");

-- Add foreign key constraint
ALTER TABLE "PassEvent" ADD CONSTRAINT "PassEvent_passId_fkey" FOREIGN KEY ("passId") REFERENCES "Pass"("id") ON DELETE CASCADE ON UPDATE CASCADE;
