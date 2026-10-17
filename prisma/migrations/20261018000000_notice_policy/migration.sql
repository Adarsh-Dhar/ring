-- Minimum-notice policy (spec section 3). All columns are nullable or defaulted, so existing rows keep working.
ALTER TABLE "Household" ADD COLUMN IF NOT EXISTS "minNoticeHours" INTEGER;
ALTER TABLE "Household" ADD COLUMN IF NOT EXISTS "shortNoticePolicy" TEXT NOT NULL DEFAULT 'helper_approval';
ALTER TABLE "Household" ADD COLUMN IF NOT EXISTS "unknownVisitorPolicy" TEXT NOT NULL DEFAULT 'ai_first_contact';
ALTER TABLE "ExpectedVisit" ADD COLUMN IF NOT EXISTS "arrangedAt" TIMESTAMP(3);
ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "noticeStatus" TEXT;
