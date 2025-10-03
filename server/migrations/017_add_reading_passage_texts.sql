ALTER TABLE exam_sections
  ADD COLUMN IF NOT EXISTS passage_texts JSONB;

-- Seed existing reading passage text into passage_texts for backward compatibility
UPDATE exam_sections
SET passage_texts = jsonb_build_object('1', passage_text)
WHERE section_type = 'reading'
  AND passage_text IS NOT NULL
  AND (passage_texts IS NULL OR passage_texts = '{}'::jsonb);
