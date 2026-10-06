-- Migration to encrypt existing Google Calendar tokens
-- This is a data migration that should be run with a script
-- The schema comments are updated to indicate encryption

COMMENT ON COLUMN "User"."googleAccessToken" IS 'Encrypted Google OAuth access token for Calendar';
COMMENT ON COLUMN "User"."googleRefreshToken" IS 'Encrypted Google OAuth refresh token for Calendar';
