-- Raw observations, interview-state stamps and helper corrections behind a case's risk score (spec section 4.4).
-- schema.prisma already declares this column; no earlier migration created it.
ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "riskObservations" JSON;
