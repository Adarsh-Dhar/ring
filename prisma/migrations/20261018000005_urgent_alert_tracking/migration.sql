-- Migration 0005: urgent alert tracking
-- Spec 4.4 rule 5: threats bypass the helper-acknowledgement timer.
-- urgentAlertedAt is set exactly once (compare-and-set) when a confirmed immediate_threat
-- triggers alertUrgent(). It mirrors the emergencyAlertedAt pattern from migration 0004.

ALTER TABLE "Case" ADD COLUMN "urgentAlertedAt" TIMESTAMP(3);
