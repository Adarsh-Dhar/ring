-- AI agents (advisory only). All additive; safe to deploy before the code.

ALTER TABLE "Household" ADD COLUMN "aiEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Household" ADD COLUMN "aiGreeter" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Case" ADD COLUMN "visitorSummary" TEXT;
ALTER TABLE "Case" ADD COLUMN "riskFlags" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Case" ADD COLUMN "clipDescription" TEXT;
ALTER TABLE "Case" ADD COLUMN "clipTags" JSONB;
ALTER TABLE "Case" ADD COLUMN "greeterState" TEXT;

ALTER TABLE "VisitRequest" ADD COLUMN "intakeId" TEXT;
ALTER TABLE "VisitRequest" ADD COLUMN "riskNote" TEXT;

CREATE TABLE "ResidentNote" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "rawNote" TEXT NOT NULL,
  "draftText" TEXT NOT NULL,
  "icon" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "approvedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMP(3),
  CONSTRAINT "ResidentNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ResidentNote_householdId_status_idx" ON "ResidentNote"("householdId", "status");
ALTER TABLE "ResidentNote" ADD CONSTRAINT "ResidentNote_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "VisitIntake" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "turns" JSONB NOT NULL DEFAULT '[]',
  "claims" JSONB NOT NULL DEFAULT '{}',
  "verdict" TEXT,
  "mismatches" JSONB NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL DEFAULT 'open',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VisitIntake_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VisitIntake_requestId_key" ON "VisitIntake"("requestId");
ALTER TABLE "VisitIntake" ADD CONSTRAINT "VisitIntake_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "VisitRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WeeklyDigest" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "weekStart" TIMESTAMP(3) NOT NULL,
  "facts" JSONB NOT NULL,
  "text" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WeeklyDigest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WeeklyDigest_householdId_weekStart_key" ON "WeeklyDigest"("householdId", "weekStart");
ALTER TABLE "WeeklyDigest" ADD CONSTRAINT "WeeklyDigest_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AiRun" (
  "id" TEXT NOT NULL,
  "householdId" TEXT NOT NULL,
  "agent" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "tokensIn" INTEGER NOT NULL DEFAULT 0,
  "tokensOut" INTEGER NOT NULL DEFAULT 0,
  "latencyMs" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL,
  "caseId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiRun_householdId_createdAt_idx" ON "AiRun"("householdId", "createdAt");
CREATE INDEX "AiRun_agent_createdAt_idx" ON "AiRun"("agent", "createdAt");
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
