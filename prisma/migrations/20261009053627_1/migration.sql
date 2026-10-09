/*
  Warnings:

  - You are about to drop the column `pairingAttempts` on the `ResidentDevice` table. All the data in the column will be lost.
  - Made the column `preset` on table `Household` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Household" ALTER COLUMN "preset" SET NOT NULL;

-- AlterTable
ALTER TABLE "ResidentDevice" DROP COLUMN "pairingAttempts";
