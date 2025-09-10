
// server/tests/grading.test.ts - Complete Implementation
import { testPool } from './setup';
import { query } from '../src/config/database-no-redis';
import { v4 as uuidv4 } from 'uuid';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { logger } from '../src/config/database-no-redis';

describe('Grading Service Tests', () => {
  let testSectionId: string;
  let testSessionId: string;
  let testExamId: string;

  beforeAll(async () => {
    // Create test exam
    const adminUser = await query('SELECT id FROM users WHERE email = $1', ['testadmin@example.com']);
    const adminUserId = adminUser.rows[0].id;
    testExamId = uuidv4();

    await testPool!.query(`
      INSERT INTO exams (id, title, description, exam_type, duration_minutes, passing_score, is_active, instructions, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      testExamId,
      'Grading Test Exam',
      'Test exam for grading logic',
      'academic',
      60,
      6.5,
      true,
      'Grading test instructions',
      adminUserId
    ]);

    // Create test section
    const sectionResult = await testPool!.query(`
      INSERT INTO exam_sections (id, exam_id, section_type, title, description, duration_minutes, max_score, section_order, instructions)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id
    `, [
      uuidv4(),
      testExamId,
      'reading',
      'Grading Test Section',
      'Test section for grading',
      30,
      10.0,
      1,
      'Grading test section instructions'
    ]);
    testSectionId = sectionResult.rows[0].id;

    // Create test session
    testSessionId = uuidv4();
    const studentResult = await query('SELECT id FROM users WHERE email = $1', ['teststudent@example.com']);
    const studentId = studentResult.rows[0].id;

    await testPool!.query(`
      INSERT INTO exam_sessions (id, user_id, exam_id, status, expires_at)
      VALUES ($1, $2, $3, $4, $5)
    `, [
      testSessionId,
      studentId,
      testExamId,
      'in_progress',
      new Date(Date.now() + 60 * 60 * 1000).toISOString()
    ]);
  });

  beforeEach(async () => {
    // Clear answers before each test
    await testPool!.query('DELETE FROM exam_session_answers WHERE session_id = $1', [testSessionId]);
  });

  afterAll(async () => {
    // Clean up test data
    await testPool!.query('DELETE FROM exam_session_answers WHERE session_id = $1', [testSessionId]);
    await testPool!.query('DELETE FROM exam_sessions WHERE id = $1', [testSessionId]);
    await testPool!.query('DELETE FROM exam_question_options');
    await testPool!.query('DELETE FROM exam_questions WHERE section_id = $1', [testSectionId]);
    await testPool!.query('DELETE FROM exam_sections WHERE id = $1', [testSectionId]);
    await testPool!.query('DELETE FROM exams WHERE id = $1', [testExamId]);
  });

  describe('Multiple Choice Grading', () => {
    let mcQuestionId: string;

    beforeAll(async () => {
      mcQuestionId = uuidv4();
      await testPool!.query(`
        INSERT INTO exam_questions (id, section_id, question_type, question_text, question_number, points, correct_answer)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        mcQuestionId,
        testSectionId,
        'multiple_choice',
        'What is the capital of France?',
        1,
        1.0,
        'A'
      ]);

      // Create correct option
      await testPool!.query(`
        INSERT INTO exam_question_options (id, question_id, option_text, option_letter, is_correct, option_order)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        uuidv4(),
        mcQuestionId,
        'Paris',
        'A',
        true,
        1
      ]);
    });

    it('should grade correct multiple choice answer', async () => {
      // Insert student answer
      await testPool!.query(`
        INSERT INTO exam_session_answers (id, session_id, question_id, student_answer, answered_at)
        VALUES ($1, $2, $3, $4, NOW())
      `, [
        uuidv4(),
        testSessionId,
        mcQuestionId,
        'A'
      ]);

      // Get graded answer
      const gradedAnswer = await query(`
        SELECT esa.student_answer, esa.is_correct, esa.points_earned, eq.correct_answer, eq.question_type, eq.points
        FROM exam_session_answers esa
        JOIN exam_questions eq ON esa.question_id = eq.id
        WHERE esa.session_id = $1 AND esa.question_id = $2
      `, [testSessionId, mcQuestionId]);

      expect(gradedAnswer.rows.length).toBe(1);
      expect(gradedAnswer.rows[0].is_correct).toBe(true);
      expect(gradedAnswer.rows[0].points_earned).toBe(1.0);
    });

    it('should grade incorrect multiple choice answer', async () => {
      // Insert student answer
      await testPool!.query(`
        INSERT INTO exam_session_answers (id, session_id, question_id, student_answer, answered_at)
        VALUES ($1, $2, $3, $4, NOW())
      `, [
        uuidv4(),
        testSessionId,
        mcQuestionId,
        'B'
      ]);

      // Get graded answer
      const gradedAnswer = await query(`
        SELECT esa.student_answer, esa.is_correct, esa.points_earned
        FROM exam_session_answers esa
        JOIN exam_questions eq ON esa.question_id = eq.id
        WHERE esa.session_id = $1 AND esa.question_id = $2
      `, [testSessionId, mcQuestionId]);

      expect(gradedAnswer.rows[0].is_correct).toBe(false);
      expect(gradedAnswer.rows[0].points_earned).toBe(0.0);
    });
  });

  describe('True/False/Not Given Grading', () => {
    let tfQuestionId: string;

    beforeAll(async () => {
      tfQuestionId = uuidv4();
      await testPool!.query(`
        INSERT INTO exam_questions (id, section_id, question_type, question_text, question_number, points, correct_answer)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        tfQuestionId,
        testSectionId,
        'true_false',
        'Is Paris the capital of France?',
        2,
        1.0,
        'TRUE'
      ]);
    });

    it('should grade correct TRUE answer', async () => {
      // Insert student answer
      await testPool!.query(`
        INSERT INTO exam_session_answers (id, session_id, question_id, student_answer, answered_at)
        VALUES ($1, $2, $3, $4, NOW())
      `, [
        uuidv4(),
        testSessionId,
        tfQuestionId,
        'TRUE'
      ]);

      // Get graded answer
      const gradedAnswer = await query(`
        SELECT esa.student_answer, esa.is_correct, esa.points_earned
        FROM exam_session_answers esa
        JOIN exam_questions eq ON esa.question_id = eq.id
        WHERE esa.session_id = $1 AND esa.question_id = $2
      `, [testSessionId, tfQuestionId]);

      expect(gradedAnswer.rows[0].is_correct).toBe(true);
      expect(gradedAnswer.rows[0].points_earned).toBe(1.0);
    });

    it('should grade FALSE answer correctly', async () => {
      // Insert student answer
      await testPool!.query(`
        INSERT INTO exam_session_answers (id, session_id, question_id, student_answer, answered_at)
        VALUES ($1, $2, $3, $4, NOW())
      `, [
        uuidv4(),
        testSessionId,
        tfQuestionId,
        'FALSE'
      ]);

      // Get graded answer
      const gradedAnswer = await query(`
        SELECT esa.student_answer, esa.is_correct, esa.points_earned
        FROM exam_session_answers esa
        JOIN exam_questions eq ON esa.question_id = eq.id
        WHERE esa.session_id = $1 AND esa.question_id = $2
      `, [testSessionId, tfQuestionId]);

      expect(gradedAnswer.rows[0].is_correct).toBe(false);
      expect(gradedAnswer.rows[0].points_earned).toBe(0.0);
    });
  });

  describe('Fill in the Blank Grading', () => {
    let fbQuestionId: string;

    beforeAll(async () => {
      fbQuestionId = uuidv4();
      await testPool!.query(`
        INSERT INTO exam_questions (id, section_id, question_type, question_text, question_number, points, correct_answer)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        fbQuestionId,
        testSectionId,
        'fill_blank',
        'The capital of France is ____.',
        3,
        1.0,
        'PARIS'
      ]);
    });

    it('should grade correct fill blank answer (case insensitive)', async () => {
      // Insert student answer
      await testPool!.query(`
        INSERT INTO exam_session_answers (id, session_id, question_id, student_answer, answered_at)
        VALUES ($