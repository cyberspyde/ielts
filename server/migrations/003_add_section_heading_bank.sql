-- Add section-level heading bank for matching questions
ALTER TABLE exam_sections
  ADD COLUMN IF NOT EXISTS heading_bank JSONB;


