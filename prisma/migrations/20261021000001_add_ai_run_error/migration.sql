-- Add error column to AiRun to store actual error messages when AI runs fail
-- This helps debug AI failures instead of just showing a generic "failed" status

ALTER TABLE "AiRun" ADD COLUMN "error" TEXT;
