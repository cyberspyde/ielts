-- Add approval fields to exam_sessions if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='exam_sessions' AND column_name='is_approved'
  ) THEN
    ALTER TABLE exam_sessions ADD COLUMN is_approved BOOLEAN DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='exam_sessions' AND column_name='approved_at'
  ) THEN
    ALTER TABLE exam_sessions ADD COLUMN approved_at TIMESTAMP WITH TIME ZONE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='exam_sessions' AND column_name='approved_by'
  ) THEN
    ALTER TABLE exam_sessions ADD COLUMN approved_by UUID REFERENCES users(id);
  END IF;
END$$;


