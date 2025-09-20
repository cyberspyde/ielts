-- Add image_dnd question type (drag-and-drop tokens onto anchors)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid=e.enumtypid
    WHERE t.typname='question_type' AND e.enumlabel='image_dnd'
  ) THEN
    ALTER TYPE question_type ADD VALUE 'image_dnd';
  END IF;
END$$;



