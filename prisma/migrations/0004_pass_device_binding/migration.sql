-- Visitor pass device binding.
-- secretHash: sha256 of the one-time link secret (the secret is shown once and never stored).
-- boundDeviceHash / boundAt: set on first use; later uses from another device are rejected.
ALTER TABLE "Pass" ADD COLUMN "secretHash" TEXT;
ALTER TABLE "Pass" ADD COLUMN "boundDeviceHash" TEXT;
ALTER TABLE "Pass" ADD COLUMN "boundAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Pass_secretHash_key" ON "Pass"("secretHash");
