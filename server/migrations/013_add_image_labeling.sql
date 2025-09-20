-- Add image_labeling question type
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid=e.enumtypid
    WHERE t.typname='question_type' AND e.enumlabel='image_labeling'
  ) THEN
    ALTER TYPE question_type ADD VALUE 'image_labeling';
  END IF;
END$$;



