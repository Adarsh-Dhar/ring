-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Household" (
    "id" TEXT NOT NULL,
    "residentName" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "timeoutSec" INTEGER NOT NULL DEFAULT 30,
    "quietStartHour" INTEGER NOT NULL DEFAULT 22,
    "quietEndHour" INTEGER NOT NULL DEFAULT 6,
    "quietEnabled" BOOLEAN NOT NULL DEFAULT false,
    "emergencyNumber" TEXT NOT NULL DEFAULT '112',
    "residentEpoch" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "plannedMode" TEXT NOT NULL DEFAULT 'helper',
    "requireResidentOk" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Household_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "consent" TEXT NOT NULL DEFAULT 'pending',
    "consentAt" TIMESTAMP(3),
    "position" INTEGER NOT NULL,
    "tokenEpoch" INTEGER NOT NULL DEFAULT 1,
    "emoji" TEXT NOT NULL DEFAULT '🙂',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResidentDevice" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "pairingCodeHash" TEXT NOT NULL,
    "pairingAttempts" INTEGER NOT NULL DEFAULT 0,
    "deviceTokenEpoch" INTEGER NOT NULL DEFAULT 1,
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "ResidentDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RingConnection" (
    "id" TEXT NOT NULL,
    "householdId" TEXT,
    "ringAccountId" TEXT NOT NULL,
    "encryptedAccessToken" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'unclaimed',
    "linkedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RingConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "ringDeviceId" TEXT NOT NULL,
    "online" BOOLEAN NOT NULL DEFAULT false,
    "since" TIMESTAMP(3) NOT NULL,
    "alertedAt" TIMESTAMP(3),

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Case" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "helperIndex" INTEGER NOT NULL DEFAULT 0,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "answer" TEXT,
    "answeredBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "log" JSONB NOT NULL DEFAULT '[]',
    "visitor" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "chain" JSONB NOT NULL DEFAULT '[]',
    "deviceId" TEXT,
    "ackedBy" TEXT,
    "ackedAt" TIMESTAMP(3),
    "lane" TEXT,
    "recurringId" TEXT,
    "visitIcon" TEXT,
    "visitLabel" TEXT,
    "checkWho" TEXT,
    "checkWord" TEXT,
    "selfVerifiedAt" TIMESTAMP(3),
    "checkAttempts" INTEGER NOT NULL DEFAULT 0,
    "checkMode" TEXT,
    "expectedId" TEXT,
    "regularId" TEXT,

    CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpectedVisit" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "passphrase" TEXT,
    "who" TEXT,
    "codeSecret" TEXT,
    "requestId" TEXT,
    "singleUse" BOOLEAN NOT NULL DEFAULT false,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "ExpectedVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringVisit" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "days" JSONB NOT NULL DEFAULT '[]',
    "everyNWeeks" INTEGER NOT NULL DEFAULT 1,
    "anchorWeek" INTEGER NOT NULL,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,
    "alertIfMissed" BOOLEAN NOT NULL DEFAULT false,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "lastArrived" TEXT,
    "lastMissedAlert" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "passphrase" TEXT,
    "who" TEXT,

    CONSTRAINT "RecurringVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "keys" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RingNonce" (
    "nonce" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RingNonce_pkey" PRIMARY KEY ("nonce")
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'helper',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "acceptedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitRequestLink" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "VisitRequestLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitRequest" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "note" TEXT,
    "contact" TEXT NOT NULL,
    "contactKind" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "helperOkBy" TEXT,
    "helperOkAt" TIMESTAMP(3),
    "residentOkAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "expectedVisitId" TEXT,
    "statusToken" TEXT NOT NULL,
    "deviceHash" TEXT,
    "resendCount" INTEGER NOT NULL DEFAULT 0,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestFace" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ref" TEXT,
    "embedding" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestFace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaceSighting" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "caseId" TEXT,
    "deviceId" TEXT,
    "source" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "faceCount" INTEGER NOT NULL,
    "faces" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "FaceSighting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegularVisitor" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "note" TEXT,
    "contact" TEXT NOT NULL,
    "contactKind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "embedding" TEXT,
    "photoEnc" TEXT,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "faceId" TEXT,
    "statusToken" TEXT NOT NULL,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegularVisitor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE INDEX "Membership_householdId_idx" ON "Membership"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_householdId_key" ON "Membership"("userId", "householdId");

-- CreateIndex
CREATE UNIQUE INDEX "ResidentDevice_pairingCodeHash_key" ON "ResidentDevice"("pairingCodeHash");

-- CreateIndex
CREATE INDEX "ResidentDevice_householdId_idx" ON "ResidentDevice"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "RingConnection_ringAccountId_key" ON "RingConnection"("ringAccountId");

-- CreateIndex
CREATE INDEX "RingConnection_householdId_idx" ON "RingConnection"("householdId");

-- CreateIndex
CREATE INDEX "RingConnection_ringAccountId_idx" ON "RingConnection"("ringAccountId");

-- CreateIndex
CREATE INDEX "Device_householdId_idx" ON "Device"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "Device_householdId_ringDeviceId_key" ON "Device"("householdId", "ringDeviceId");

-- CreateIndex
CREATE INDEX "Case_householdId_idx" ON "Case"("householdId");

-- CreateIndex
CREATE INDEX "Case_createdAt_idx" ON "Case"("createdAt");

-- CreateIndex
CREATE INDEX "ExpectedVisit_householdId_idx" ON "ExpectedVisit"("householdId");

-- CreateIndex
CREATE INDEX "RecurringVisit_householdId_idx" ON "RecurringVisit"("householdId");

-- CreateIndex
CREATE INDEX "PushSubscription_membershipId_idx" ON "PushSubscription"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_membershipId_endpoint_key" ON "PushSubscription"("membershipId", "endpoint");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_requestId_key" ON "WebhookEvent"("requestId");

-- CreateIndex
CREATE INDEX "WebhookEvent_householdId_idx" ON "WebhookEvent"("householdId");

-- CreateIndex
CREATE INDEX "WebhookEvent_requestId_idx" ON "WebhookEvent"("requestId");

-- CreateIndex
CREATE INDEX "OtpCode_userId_createdAt_idx" ON "OtpCode"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "OtpCode_ip_createdAt_idx" ON "OtpCode"("ip", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invite_code_key" ON "Invite"("code");

-- CreateIndex
CREATE INDEX "Invite_householdId_idx" ON "Invite"("householdId");

-- CreateIndex
CREATE INDEX "Invite_code_idx" ON "Invite"("code");

-- CreateIndex
CREATE INDEX "Invite_status_idx" ON "Invite"("status");

-- CreateIndex
CREATE UNIQUE INDEX "VisitRequestLink_tokenHash_key" ON "VisitRequestLink"("tokenHash");

-- CreateIndex
CREATE INDEX "VisitRequestLink_householdId_idx" ON "VisitRequestLink"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "VisitRequest_statusToken_key" ON "VisitRequest"("statusToken");

-- CreateIndex
CREATE INDEX "VisitRequest_householdId_status_idx" ON "VisitRequest"("householdId", "status");

-- CreateIndex
CREATE INDEX "VisitRequest_ip_createdAt_idx" ON "VisitRequest"("ip", "createdAt");

-- CreateIndex
CREATE INDEX "VisitRequest_linkId_createdAt_idx" ON "VisitRequest"("linkId", "createdAt");

-- CreateIndex
CREATE INDEX "VisitRequest_householdId_contact_createdAt_idx" ON "VisitRequest"("householdId", "contact", "createdAt");

-- CreateIndex
CREATE INDEX "GuestFace_householdId_idx" ON "GuestFace"("householdId");

-- CreateIndex
CREATE INDEX "GuestFace_householdId_ref_idx" ON "GuestFace"("householdId", "ref");

-- CreateIndex
CREATE INDEX "FaceSighting_householdId_capturedAt_idx" ON "FaceSighting"("householdId", "capturedAt");

-- CreateIndex
CREATE INDEX "FaceSighting_caseId_idx" ON "FaceSighting"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "RegularVisitor_statusToken_key" ON "RegularVisitor"("statusToken");

-- CreateIndex
CREATE INDEX "RegularVisitor_householdId_status_idx" ON "RegularVisitor"("householdId", "status");

-- CreateIndex
CREATE INDEX "RegularVisitor_ip_createdAt_idx" ON "RegularVisitor"("ip", "createdAt");

-- CreateIndex
CREATE INDEX "RegularVisitor_linkId_createdAt_idx" ON "RegularVisitor"("linkId", "createdAt");

-- CreateIndex
CREATE INDEX "RegularVisitor_householdId_contact_createdAt_idx" ON "RegularVisitor"("householdId", "contact", "createdAt");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResidentDevice" ADD CONSTRAINT "ResidentDevice_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RingConnection" ADD CONSTRAINT "RingConnection_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpectedVisit" ADD CONSTRAINT "ExpectedVisit_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringVisit" ADD CONSTRAINT "RecurringVisit_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtpCode" ADD CONSTRAINT "OtpCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitRequestLink" ADD CONSTRAINT "VisitRequestLink_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitRequest" ADD CONSTRAINT "VisitRequest_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitRequest" ADD CONSTRAINT "VisitRequest_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "VisitRequestLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestFace" ADD CONSTRAINT "GuestFace_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceSighting" ADD CONSTRAINT "FaceSighting_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegularVisitor" ADD CONSTRAINT "RegularVisitor_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegularVisitor" ADD CONSTRAINT "RegularVisitor_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "VisitRequestLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

