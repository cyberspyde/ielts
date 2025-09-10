-- Migration 010: Add exam-level audio_url and backfill from listening section
-- Adds audio_url column to exams so a single audio file can be used for the entire exam (e.g., Listening audio played once).

ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS audio_url VARCHAR(500);

-- Backfill: copy first listening section audio (if any) into exam.audio_url
UPDATE exams e
SET audio_url = sub.audio_url
FROM (
  SELECT exam_id, audio_url
  FROM exam_sections
  WHERE section_type = 'listening' AND audio_url IS NOT NULL
  ORDER BY created_at
) sub
WHERE sub.exam_id = e.id AND e.audio_url IS NULL;

-- (Optional) You may later choose to null-out section-level audio once verified.
-- UPDATE exam_sections SET audio_url = NULL WHERE section_type = 'listening';
