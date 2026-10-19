-- Section 5: normalize the independent timer map after the initial backfill.
-- `none` and `emergency` are scheduler sentinel states, never timer kinds.
UPDATE "Case"
SET "timerDeadlines" = '{}'::jsonb
WHERE "deadlineKind" IN ('none', 'emergency')
   OR "status" <> 'waiting';

-- Recover an active deadline for legacy waiting rows whose map is empty. Keep the timer kind
-- only when it is a valid timer kind; old rows without a kind fall back to household.
UPDATE "Case"
SET "timerDeadlines" = jsonb_build_object(
  COALESCE(NULLIF("deadlineKind", ''), 'household'),
  floor(extract(epoch FROM "deadlineAt") * 1000)::bigint
)
WHERE "status" = 'waiting'
  AND COALESCE(NULLIF("deadlineKind", ''), 'household') IN ('household', 'approval', 'risk_decision', 'takeover')
  AND ("timerDeadlines" IS NULL OR "timerDeadlines" = '{}'::jsonb);
