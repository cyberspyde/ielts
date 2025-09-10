-- Add table-based question types
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname='question_type' AND e.enumlabel='table_fill_blank'
  ) THEN
    ALTER TYPE question_type ADD VALUE 'table_fill_blank';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname='question_type' AND e.enumlabel='table_drag_drop'
  ) THEN
    ALTER TYPE question_type ADD VALUE 'table_drag_drop';
  END IF;
END$$;

-- Metadata contract:
-- table_fill_blank: metadata.table = { rows: string[][], sizes?: { w?: number; h?: number }[][] }
-- table_drag_drop: same base shape + optionally metadata.tokens per anchor or future slot definitions.