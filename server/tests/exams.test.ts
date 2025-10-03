// server/tests/exams.test.ts
import request from 'supertest';
import { app } from '../src/index';
import { seedTestData, testPool, getTestAdminToken, getTestStudentToken } from './setup';
import { query } from '../src/config/database-no-redis';
import { v4 as uuidv4 } from 'uuid';

describe('Exam Routes Tests', () => {
  let adminToken: string;
  let studentToken: string;
  let testExamId: string;
  let testSectionId: string;
  let testQuestionId: string;
  let testTicketCode: string;
  let groupAnchorQuestionId: string;
  let groupMemberQuestionId: string;

  beforeAll(async () => {
    await seedTestData();
    
    // Get tokens
    adminToken = await getTestAdminToken();
    studentToken = await getTestStudentToken();

    // Create test exam data
    const adminUser = await query('SELECT id FROM users WHERE email = $1', ['testadmin@example.com']);
    const adminUserId = adminUser.rows[0].id;

    // Create test exam
    const examResult = await testPool!.query(`
      INSERT INTO exams (id, title, description, exam_type, duration_minutes, passing_score, is_active, instructions, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id
    `, [
      uuidv4(),
      'Test Exam',
      'Test description',
      'academic',
      60,
      6.5,
      true,
      'Test instructions',
      adminUserId
    ]);
    testExamId = examResult.rows[0].id;

    // Create test section
    const sectionResult = await testPool!.query(`
      INSERT INTO exam_sections (id, exam_id, section_type, title, description, duration_minutes, max_score, section_order, instructions)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id
    `, [
      uuidv4(),
      testExamId,
      'reading',
      'Test Section',
      'Test section description',
      30,
      9.0,
      1,
      'Test section instructions'
    ]);
    testSectionId = sectionResult.rows[0].id;

    // Create test question
    const questionResult = await testPool!.query(`
      INSERT INTO exam_questions (id, section_id, question_type, question_text, question_number, points, correct_answer)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
    `, [
      uuidv4(),
      testSectionId,
      'multiple_choice',
      'Test question text',
      1,
      1.0,
      'A'
    ]);
    testQuestionId = questionResult.rows[0].id;

    // Create grouped multi-select anchor and member questions
    groupAnchorQuestionId = uuidv4();
    groupMemberQuestionId = uuidv4();
    await testPool!.query(`
      INSERT INTO exam_questions (id, section_id, question_type, question_text, question_number, points, correct_answer, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      groupAnchorQuestionId,
      testSectionId,
      'multiple_choice',
      'Grouped anchor question',
      10,
      1.0,
      'A|B',
      JSON.stringify({ groupRangeEnd: 11, allowMultiSelect: true })
    ]);

    await testPool!.query(`
      INSERT INTO exam_questions (id, section_id, question_type, question_text, question_number, points, correct_answer, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      groupMemberQuestionId,
      testSectionId,
      'multiple_choice',
      'Grouped member question',
      11,
      1.0,
      'A|B',
      JSON.stringify({ groupMemberOf: groupAnchorQuestionId })
    ]);

    // Create test question option
    await testPool!.query(`
      INSERT INTO exam_question_options (id, question_id, option_text, option_letter, is_correct, option_order)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      uuidv4(),
      testQuestionId,
      'Test option A',
      'A',
      true,
      1
    ]);

    // Create test ticket
    const ticketResult = await testPool!.query(`
      INSERT INTO tickets (id, ticket_code, exam_id, status, valid_until, max_uses, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ticket_code
    `, [
      uuidv4(),
      'TESTTICKET123',
      testExamId,
      'active',
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      1,
      adminUserId
    ]);
    testTicketCode = ticketResult.rows[0].ticket_code;
  });

  afterAll(async () => {
    // Clean up test data
    await testPool!.query('DELETE FROM exam_question_options WHERE question_id IN (SELECT id FROM exam_questions WHERE section_id = $1)', [testSectionId]);
    await testPool!.query('DELETE FROM exam_questions WHERE section_id = $1', [testSectionId]);
    await testPool!.query('DELETE FROM exam_sections WHERE exam_id = $1', [testExamId]);
    await testPool!.query('DELETE FROM exams WHERE id = $1', [testExamId]);
    await testPool!.query('DELETE FROM tickets WHERE ticket_code = $1', [testTicketCode]);
  });

  describe('GET /api/exams', () => {
    it('should list available exams for authenticated student', async () => {
      const response = await request(app)
        .get('/api/exams')
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    it('should deny access to exams without authentication', async () => {
      const response = await request(app)
        .get('/api/exams')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Authentication required');
    });

    it('should filter active exams only', async () => {
      // Create inactive exam for testing
      const adminUser = await query('SELECT id FROM users WHERE email = $1', ['testadmin@example.com']);
      const inactiveExamId = uuidv4();
      
      await testPool!.query(`
        INSERT INTO exams (id, title, description, exam_type, duration_minutes, passing_score, is_active, instructions, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        inactiveExamId,
        'Inactive Exam',
        'Inactive exam description',
        'academic',
        60,
        6.5,
        false,
        'Inactive instructions',
        adminUser.rows[0].id
      ]);

      const response = await request(app)
        .get('/api/exams')
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      const exams = response.body.data;
      const inactiveExam = exams.find((exam: any) => exam.id === inactiveExamId);
      expect(inactiveExam).toBeUndefined();
    });
  });

  describe('GET /api/exams/:id', () => {
    it('should get exam details with questions for authenticated user', async () => {
      const response = await request(app)
        .get(`/api/exams/${testExamId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id', testExamId);
      expect(response.body.data).toHaveProperty('title', 'Test Exam');
      expect(response.body.data.sections).toBeDefined();
      expect(response.body.data.sections.length).toBeGreaterThan(0);
      expect(response.body.data.sections[0].questions).toBeDefined();
      expect(response.body.data.sections[0].questions.length).toBeGreaterThan(0);
    });

    it('should include questions when requested', async () => {
      const response = await request(app)
        .get(`/api/exams/${testExamId}?questions=true`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      const exam = response.body.data;
      expect(exam.sections[0].questions).toBeDefined();
      expect(exam.sections[0].questions[0]).toHaveProperty('questionText', 'Test question text');
      expect(exam.sections[0].questions[0]).toHaveProperty('questionType', 'multiple_choice');
    });

    it('should not include questions by default', async () => {
      const response = await request(app)
        .get(`/api/exams/${testExamId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      const exam = response.body.data;
      expect(exam.sections[0].questions).toBeUndefined();
    });

    it('should deny access to non-existent exam', async () => {
      const response = await request(app)
        .get(`/api/exams/${uuidv4()}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('not found');
    });

    it('should deny access without authentication', async () => {
      const response = await request(app)
        .get(`/api/exams/${testExamId}`)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Authentication required');
    });
  });

  describe('POST /api/exams/:id/start', () => {
    it('should start exam session for authenticated student', async () => {
      const response = await request(app)
        .post(`/api/exams/${testExamId}/start`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({})
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('sessionId');
      expect(response.body.data.status).toBe('in_progress');
      expect(response.body.data.examId).toBe(testExamId);
    });

    it('should start exam session with specific section', async () => {
      const response = await request(app)
        .post(`/api/exams/${testExamId}/start`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ section: 'reading' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('sessionId');
      expect(response.body.data.currentSectionId).toBeDefined();
    });

    it('should fail to start exam for inactive exam', async () => {
      const adminUser = await query('SELECT id FROM users WHERE email = $1', ['testadmin@example.com']);
      const inactiveExamId = uuidv4();
      
      await testPool!.query(`
        INSERT INTO exams (id, title, description, exam_type, duration_minutes, passing_score, is_active, instructions, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        inactiveExamId,
        'Inactive Exam',
        'Inactive exam description',
        'academic',
        60,
        6.5,
        false,
        'Inactive instructions',
        adminUser.rows[0].id
      ]);

      const response = await request(app)
        .post(`/api/exams/${inactiveExamId}/start`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('not currently available');
    });

    it('should fail to start exam without authentication', async () => {
      const response = await request(app)
        .post(`/api/exams/${testExamId}/start`)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Authentication required');
    });
  });

  describe('POST /api/exams/sessions/:sessionId/submit', () => {
    it('should submit exam answers successfully', async () => {
      // Start session first
      const startResponse = await request(app)
        .post(`/api/exams/${testExamId}/start`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      const sessionId = startResponse.body.data.sessionId;
      const answers = [
        {
          questionId: testQuestionId,
          studentAnswer: 'A'
        }
      ];

      const response = await request(app)
        .post(`/api/exams/sessions/${sessionId}/submit`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ answers })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('sessionId', sessionId);
      expect(response.body.data.status).toBe('submitted');
    });

    it('should calculate correct score for multiple choice', async () => {
      // Start session
      const startResponse = await request(app)
        .post(`/api/exams/${testExamId}/start`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      const sessionId = startResponse.body.data.sessionId;
      
      // Submit correct answer
      const correctAnswers = [
        {
          questionId: testQuestionId,
          studentAnswer: 'A' // Correct answer
        }
      ];

      const correctResponse = await request(app)
        .post(`/api/exams/sessions/${sessionId}/submit`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ answers: correctAnswers })
        .expect(200);

      // Check database for correct scoring
      const sessionResult = await query('SELECT * FROM exam_sessions WHERE id = $1', [sessionId]);
      const answerResult = await query('SELECT * FROM exam_session_answers WHERE session_id = $1', [sessionId]);

      expect(sessionResult.rows[0].total_score).toBeGreaterThan(0);
      expect(answerResult.rows[0].is_correct).toBe(true);
      expect(answerResult.rows[0].points_earned).toBe(1.0);
    });

    it('should propagate grouped multi-select answers to grouped members', async () => {
      const startResponse = await request(app)
        .post(`/api/exams/${testExamId}/start`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      const sessionId = startResponse.body.data.sessionId;

      const answers = [
        {
          questionId: groupAnchorQuestionId,
          studentAnswer: ['A', 'B']
        }
      ];

      await request(app)
        .post(`/api/exams/sessions/${sessionId}/submit`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ answers })
        .expect(200);

      const graded = await query(
        'SELECT question_id, student_answer, is_correct, points_earned FROM exam_session_answers WHERE session_id = $1 AND question_id IN ($2, $3) ORDER BY question_id',
        [sessionId, groupAnchorQuestionId, groupMemberQuestionId]
      );

      expect(graded.rowCount).toBe(2);
      graded.rows.forEach((row: any) => {
        const parsed = JSON.parse(row.student_answer || 'null');
        expect(parsed).toEqual(['A', 'B']);
        expect(row.is_correct).toBe(true);
        expect(Number(row.points_earned)).toBeCloseTo(1.0);
      });

      const sessionRow = await query('SELECT total_score FROM exam_sessions WHERE id = $1', [sessionId]);
      expect(Number(sessionRow.rows[0].total_score)).toBeCloseTo(2.0);

      await testPool!.query('DELETE FROM exam_session_answers WHERE session_id = $1', [sessionId]);
      await testPool!.query('DELETE FROM exam_sessions WHERE id = $1', [sessionId]);
    });

    it('should fail to submit for non-existent session', async () => {
      const invalidSessionId = uuidv4();
      const answers = [
        {
          questionId: testQuestionId,
          studentAnswer: 'A'
        }
      ];

      const response = await request(app)
        .post(`/api/exams/sessions/${invalidSessionId}/submit`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ answers })
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('not found');
    });

    it('should fail to submit without authentication', async () => {
      const startResponse = await request(app)
        .post(`/api/exams/${testExamId}/start`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      const sessionId = startResponse.body.data.sessionId;
      const answers = [{ questionId: testQuestionId, studentAnswer: 'A' }];

      const response = await request(app)
        .post(`/api/exams/sessions/${sessionId}/submit`)
        .send({ answers })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Authentication required');
    });
  });

  describe('GET /api/exams/sessions/:sessionId/results', () => {
    it('should get exam results after submission', async () => {
      // Start session and submit
      const startResponse = await request(app)
        .post(`/api/exams/${testExamId}/start`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      const sessionId = startResponse.body.data.sessionId;
      const answers = [
        {
          questionId: testQuestionId,
          studentAnswer: 'A'
        }
      ];

      await request(app)
        .post(`/api/exams/sessions/${sessionId}/submit`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ answers })
        .expect(200);

      // Get results
      const response = await request(app)
        .get(`/api/exams/sessions/${sessionId}/results`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('sessionId', sessionId);
      expect(response.body.data).toHaveProperty('totalScore');
      expect(response.body.data).toHaveProperty('percentageScore');
      expect(response.body.data).toHaveProperty('sectionScores');
    });

    it('should fail to get results for unsubmitted session', async () => {
      const startResponse = await request(app)
        .post(`/api/exams/${testExamId}/start`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      const sessionId = startResponse.body.data.sessionId;

      const response = await request(app)
        .get(`/api/exams/sessions/${sessionId}/results`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('not yet submitted');
    });

    it('should fail to get results for non-existent session', async () => {
      const response = await request(app)
        .get(`/api/exams/sessions/${uuidv4()}/results`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('not found');
    });
  });

  describe('Ticket-based Exam Access', () => {
    it('should start exam using valid ticket without authentication', async () => {
      const response = await request(app)
        .post(`/exams/${testExamId}/start?ticket=${testTicketCode}`)
        .send({})
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('sessionId');
      expect(response.body.data.ticketCode).toBe(testTicketCode);
    });

    it('should fail to start exam with invalid ticket', async () => {
      const response = await request(app)
        .post(`/exams/${testExamId}/start?ticket=INVALIDTICKET`)
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Ticket is not valid');
    });

    it('should validate ticket without starting exam', async () => {
      const response = await request(app)
        .get(`/tickets/${testTicketCode}`)
        .expect(200);

      expect(response.body.valid).toBe(true);
      expect(response.body.examTitle).toBe('Test Exam');
    });

    it('should mark ticket as used after exam completion', async () => {
      // Start with ticket
      const startResponse = await request(app)
        .post(`/exams/${testExamId}/start?ticket=${testTicketCode}`)
        .send({})
        .expect(200);

      const sessionId = startResponse.body.data.sessionId;

      // Submit exam
      const answers = [
        {
          questionId: testQuestionId,
          studentAnswer: 'A'
        }
      ];

      await request(app)
        .post(`/exams/sessions/${sessionId}/submit`)
        .send({ answers })
        .expect(200);

      // Check ticket usage
      const ticketUsage = await query('SELECT * FROM ticket_usage WHERE ticket_id IN (SELECT id FROM tickets WHERE ticket_code = $1)', [testTicketCode]);
      expect(ticketUsage.rows.length).toBe(1);

      // Check ticket status
      const ticketStatus = await query('SELECT status, current_uses FROM tickets WHERE ticket_code = $1', [testTicketCode]);
      expect(ticketStatus.rows[0].status).toBe('used');
      expect(ticketStatus.rows[0].current_uses).toBe(1);
    });
  });

  afterAll(async () => {
    // Clean up test data
    await testPool!.query('DELETE FROM ticket_usage');
    await testPool!.query('DELETE FROM exam_session_answers');
    await testPool!.query('DELETE FROM exam_sessions');
    await testPool!.query('DELETE FROM tickets');
    await testPool!.query('DELETE FROM exam_question_options');
    await testPool!.query('DELETE FROM exam_questions');
    await testPool!.query('DELETE FROM exam_sections');
    await testPool!.query('DELETE FROM exams WHERE title = $1', ['Test Exam']);
  });
});