-- Migration 008: Add simple_table question type to enum
-- This migration adds the simple_table question type to support simplified table editing

-- Add the simple_table enum value
ALTER TYPE question_type ADD VALUE 'simple_table';

-- Update any existing constraints or indexes if needed
-- (No additional changes required for this migration)
