-- Extend option_letter to support multi-character labels (e.g., roman numerals)
ALTER TABLE exam_question_options
  ALTER COLUMN option_letter TYPE VARCHAR(12) USING option_letter::varchar;


