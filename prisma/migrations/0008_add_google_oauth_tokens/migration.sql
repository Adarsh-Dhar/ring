-- Add Google Calendar OAuth token fields to User model
ALTER TABLE "User" ADD COLUMN "googleAccessToken" TEXT;
ALTER TABLE "User" ADD COLUMN "googleRefreshToken" TEXT;
ALTER TABLE "User" ADD COLUMN "googleTokenExpiry" TIMESTAMP(3);
