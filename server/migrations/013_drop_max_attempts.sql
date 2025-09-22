-- 013_drop_max_attempts.sql
-- Purpose: Remove deprecated max_attempts column from exams table
-- Notes:
--  - This column is no longer used. Single-attempt policy is enforced in server logic.
--  - Keep this migration idempotent so re-running migrations is safe.

BEGIN;

-- Drop column only if it exists to keep migration idempotent
ALTER TABLE IF EXISTS exams
  DROP COLUMN IF EXISTS max_attempts;

COMMIT;
