-- Migration 0006: approval timer (spec 5.3)
-- Resident-set seconds a helper has to approve a short-notice visit. NULL = pilot default (120).
ALTER TABLE "Household" ADD COLUMN "approvalTimerSec" INTEGER;
