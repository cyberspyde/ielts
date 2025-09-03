-- Add new question_type value 'multi_select' to enum
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'question_type' AND e.enumlabel = 'multi_select'
    ) THEN
        ALTER TYPE question_type ADD VALUE 'multi_select';
    END IF;
END$$;
