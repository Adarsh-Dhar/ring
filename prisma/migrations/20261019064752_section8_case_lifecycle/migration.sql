-- AlterTable
ALTER TABLE "Case" ADD COLUMN     "lifecycleState" TEXT,
ADD COLUMN     "outcome" TEXT,
ADD COLUMN     "outcomeReason" TEXT,
ADD COLUMN     "quietPeriodMinutes" INTEGER,
ADD COLUMN     "seriousEventsResolvedAt" TIMESTAMP(3),
ADD COLUMN     "visitorLeftAt" TIMESTAMP(3),
ALTER COLUMN "emergencyAlertedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "unconfirmedAlertedAt" SET DATA TYPE TIMESTAMP(3);
