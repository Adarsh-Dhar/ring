-- Add deadline tracking fields to Case model
-- deadlineKind: identifies which timer set the current deadline (household | approval | risk_decision | takeover)
-- timerDeadlines: stores all timer deadlines for audit and comparison
ALTER TABLE "Case" ADD COLUMN "deadlineKind" TEXT;
ALTER TABLE "Case" ADD COLUMN "timerDeadlines" JSONB;
