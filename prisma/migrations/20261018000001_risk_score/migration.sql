-- Deterministic risk score and evidence ledger (spec sections 1 and 4). Nullable: old cases simply have none.
ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "riskScore" INTEGER;
ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "riskLedger" JSON;
