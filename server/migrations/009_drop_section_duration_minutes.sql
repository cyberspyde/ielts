-- Migration 009: Drop per-section duration_minutes
-- Rationale: Platform now enforces a single global exam duration (exams.duration_minutes).
-- The exam_sections.duration_minutes column is deprecated and all application
-- code references have been removed. Existing data in that column is discarded.

ALTER TABLE exam_sections
  DROP COLUMN IF EXISTS duration_minutes;

-- No data backfill required; sessions rely solely on exams.duration_minutes.