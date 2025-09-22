-- Migration 016: Composite exams and bundled session support
ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS is_composite BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS bundle_listening_exam_id UUID REFERENCES exams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bundle_reading_exam_id UUID REFERENCES exams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bundle_writing_exam_id UUID REFERENCES exams(id) ON DELETE SET NULL;

-- Normalize existing rows
UPDATE exams
SET is_composite = FALSE
WHERE is_composite IS NULL;

ALTER TABLE exam_sessions
  ADD COLUMN IF NOT EXISTS parent_session_id UUID REFERENCES exam_sessions(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS bundle_step TEXT CHECK (bundle_step IN ('listening','reading','writing') OR bundle_step IS NULL);
