-- Add new question_type enum values 'short_answer' and 'writing_task1'
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'question_type' AND e.enumlabel = 'short_answer'
    ) THEN
        ALTER TYPE question_type ADD VALUE 'short_answer';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'question_type' AND e.enumlabel = 'writing_task1'
    ) THEN
        ALTER TYPE question_type ADD VALUE 'writing_task1';
    END IF;
END$$;
