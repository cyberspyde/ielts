-- Ensure unique question number per section
ALTER TABLE exam_questions
  ADD CONSTRAINT uq_exam_questions_section_question UNIQUE (section_id, question_number);


