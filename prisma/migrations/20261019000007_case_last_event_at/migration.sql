-- Spec 5.2: time of the last risk event, third key of the dashboard order.
ALTER TABLE "Case" ADD COLUMN IF NOT EXISTS "lastEventAt" TIMESTAMP(3);
UPDATE "Case" SET "lastEventAt" = "createdAt" WHERE "lastEventAt" IS NULL;
