-- AI risk assessment (advisory, helper-only). Additive; safe to deploy before the code.
ALTER TABLE "Case" ADD COLUMN "riskLevel" TEXT;
ALTER TABLE "Case" ADD COLUMN "riskAssessment" JSONB;
