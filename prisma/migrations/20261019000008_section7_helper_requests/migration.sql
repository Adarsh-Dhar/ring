-- Create HelperRequest table for Section 7 request state machine
CREATE TABLE "HelperRequest" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "state" TEXT NOT NULL DEFAULT 'sent',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "ackedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "timedOutAt" TIMESTAMP(3),
    "channels" JSONB NOT NULL DEFAULT '{}',
    "snapshot" JSONB,

    CONSTRAINT "HelperRequest_pkey" PRIMARY KEY ("id")
);

-- Add indexes for HelperRequest
CREATE INDEX "HelperRequest_caseId_idx" ON "HelperRequest"("caseId");
CREATE INDEX "HelperRequest_membershipId_idx" ON "HelperRequest"("membershipId");
CREATE INDEX "HelperRequest_state_idx" ON "HelperRequest"("state");

-- Add tier column to Membership
ALTER TABLE "Membership" ADD COLUMN "tier" TEXT NOT NULL DEFAULT 'primary';

-- Add conversationOwner and pendingActions to Case
ALTER TABLE "Case" ADD COLUMN "conversationOwner" TEXT;
ALTER TABLE "Case" ADD COLUMN "pendingActions" JSONB;

-- Add approvalRetrySec to Household
ALTER TABLE "Household" ADD COLUMN "approvalRetrySec" INTEGER NOT NULL DEFAULT 300;

-- Add foreign key constraints
ALTER TABLE "HelperRequest" ADD CONSTRAINT "HelperRequest_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HelperRequest" ADD CONSTRAINT "HelperRequest_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
