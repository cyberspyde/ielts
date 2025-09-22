-- Migration 015: Add exam tags array for categorisation and ensure default empty arrays
ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'::text[];

UPDATE exams
  SET tags = '{}'::text[]
  WHERE tags IS NULL;
