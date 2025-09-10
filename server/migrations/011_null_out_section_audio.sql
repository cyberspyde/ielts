-- Migration 011: Null out legacy per-section listening audio now that exam-level audio is centralized
-- Safe after verifying migration 010 backfilled exams.audio_url.
-- Run ONLY after confirming frontend uses exam.audioUrl exclusively.

UPDATE exam_sections
SET audio_url = NULL
WHERE section_type = 'listening' AND audio_url IS NOT NULL;

-- (Column retained for backward compatibility; consider dropping in a future migration.)
