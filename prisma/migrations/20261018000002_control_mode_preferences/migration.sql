-- Resident preferences and the control mode the controller picked for a case (spec sections 1 and 2).
ALTER TABLE "Household" ADD COLUMN IF NOT EXISTS "preferences" JSON;
ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "controlMode" TEXT;
