-- Add attempt tracking to ResidentDevice so brute-force attempts are
-- persisted across restarts and the code is invalidated after too many failures.
ALTER TABLE "ResidentDevice" ADD COLUMN "pairingAttempts" INTEGER NOT NULL DEFAULT 0;
