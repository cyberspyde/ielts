// server/tests/admin.test.ts
import request from 'supertest';
import { app } from '../src/index';
import { seedTestData, testPool, getTestAdminToken, getTestStudentToken } from './setup';
import { query } from '../src/config/database-no-redis';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

describe('Admin Routes Tests', () => {
  let adminToken: string;
  let studentToken: string;
  let testExamId: string;
  let testStudentId: string;

  beforeAll(async () => {
    await seedTestData();
    
    adminToken = await getTestAdminToken();
    studentToken = await getTestStudentToken();

    // Get test student ID for user management tests
    const studentResult = await query('SELECT id FROM users WHERE email = $1', ['teststudent@example.com']);
    testStudentId = studentResult.rows[0].id;

    // Create test exam for admin management
    const adminUser = await query('SELECT id FROM users WHERE email = $1', ['testadmin@example.com']);
    const adminUserId = adminUser.rows[0].id;

    const examResult = await testPool!.query(`
      INSERT INTO exams (id, title, description, exam_type, duration_minutes, passing_score, is_active, instructions, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id
    `, [
      uuidv4(),
      'Admin Test Exam',
      'Test exam for admin management',
      'academic',
      60,
      6.5,
      true,
      'Admin test instructions',
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
    const testSectionId = sectionResult.rows[0].id;

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
    const testQuestionId = questionResult.rows[0].id;

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
  });

  afterAll(async () => {
    // Clean up test data
    await testPool!.query('DELETE FROM exams WHERE id = $1', [testExamId]);
    await testPool!.query('DELETE FROM tickets WHERE exam_id = $1', [testExamId]);
  });

  describe('GET /api/admin/dashboard', () => {
    it('should return dashboard statistics for admin', async () => {
      const response = await request(app)
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('totalStudents');
      expect(response.body.data).toHaveProperty('totalExams');
      expect(response.body.data).toHaveProperty('activeExams');
      expect(response.body.data).toHaveProperty('totalTickets');
      expect(response.body.data).toHaveProperty('usedTickets');
      expect(response.body.data).toHaveProperty('totalAdmins');
      expect(response.body.data).toHaveProperty('pendingTickets');
      expect(response.body.data.examSessions).toHaveProperty('active');
      expect(response.body.data.examSessions).toHaveProperty('completed');
      expect(response.body.data.examSessions).toHaveProperty('abandoned');
      expect(Array.isArray(response.body.data.recentResults)).toBe(true);
    });

    it('should deny student access to dashboard', async () => {
      const response = await request(app)
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Access denied');
    });

    it('should deny access without authentication', async () => {
      const response = await request(app)
        .get('/api/admin/dashboard')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Authentication required');
    });
  });

  describe('POST /api/admin/exams', () => {
    it('should create new exam as admin', async () => {
      const newExam = {
        title: 'New Admin Exam',
        description: 'New exam created by admin',
        examType: 'academic',
        durationMinutes: 120,
        passingScore: 6.5,
        maxAttempts: 3,
        instructions: 'New exam instructions'
      };

      const response = await request(app)
        .post('/api/admin/exams')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(newExam)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data.title).toBe(newExam.title);
      expect(response.body.data.examType).toBe(newExam.examType);
      expect(response.body.data.durationMinutes).toBe(newExam.durationMinutes);
      expect(response.body.data.passingScore).toBe(newExam.passingScore);
      expect(response.body.data.isActive).toBe(true);
      expect(response.body.data.createdBy).toBeDefined();

      // Verify exam was created in database
      const dbExam = await query('SELECT * FROM exams WHERE title = $1', [newExam.title]);
      expect(dbExam.rows.length).toBe(1);
      expect(dbExam.rows[0].is_active).toBe(true);
    });

    it('should fail to create exam without required fields', async () => {
      const incompleteExam = {
        // Missing title and other required fields
      };

      const response = await request(app)
        .post('/api/admin/exams')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(incompleteExam)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('required');
    });

    it('should deny student access to create exam', async () => {
      const newExam = {
        title: 'Student Exam Attempt',
        description: 'Attempt by student',
        examType: 'academic',
        durationMinutes: 60,
        passingScore: 6.0
      };

      const response = await request(app)
        .post('/api/admin/exams')
        .set('Authorization', `Bearer ${studentToken}`)
        .send(newExam)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Access denied');
    });
  });

  describe('GET /api/admin/exams', () => {
    it('should list all exams for admin', async () => {
      const response = await request(app)
        .get('/api/admin/exams')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.pagination).toBeDefined();
    });

    it('should support pagination for admin exams', async () => {
      const response = await request(app)
        .get('/api/admin/exams?page=1&limit=5')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.pagination.page).toBe(1);
      expect(response.body.pagination.limit).toBe(5);
      expect(response.body.pagination.total).toBeDefined();
      expect(response.body.pagination.totalPages).toBeDefined();
    });

    it('should deny student access to admin exams list', async () => {
      const response = await request(app)
        .get('/api/admin/exams')
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Access denied');
    });
  });

  describe('PUT /api/admin/exams/:id', () => {
    it('should update exam as admin', async () => {
      const updateData = {
        title: 'Updated Test Exam',
        description: 'Updated description',
        durationMinutes: 90,
        passingScore: 7.0,
        isActive: false
      };

      const response = await request(app)
        .put(`/api/admin/exams/${testExamId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.title).toBe(updateData.title);
      expect(response.body.data.durationMinutes).toBe(updateData.durationMinutes);
      expect(response.body.data.passingScore).toBe(updateData.passingScore);
      expect(response.body.data.isActive).toBe(updateData.isActive);

      // Verify update in database
      const dbExam = await query('SELECT * FROM exams WHERE id = $1', [testExamId]);
      expect(dbExam.rows[0].title).toBe(updateData.title);
      expect(dbExam.rows[0].is_active).toBe(false);
    });

    it('should fail to update non-existent exam', async () => {
      const updateData = {
        title: 'Non-existent Exam Update'
      };

      const response = await request(app)
        .put(`/api/admin/exams/${uuidv4()}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(updateData)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('not found');
    });

    it('should deny student access to update exam', async () => {
      const updateData = {
        title: 'Student Update Attempt'
      };

      const response = await request(app)
        .put(`/api/admin/exams/${testExamId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send(updateData)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Access denied');
    });
  });

  describe('DELETE /api/admin/exams/:id', () => {
    it('should delete exam as admin', async () => {
      // Create exam to delete
      const adminUser = await query('SELECT id FROM users WHERE email = $1', ['testadmin@example.com']);
      const examToDeleteId = uuidv4();
      
      await testPool!.query(`
        INSERT INTO exams (id, title, description, exam_type, duration_minutes, passing_score, is_active, instructions, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        examToDeleteId,
        'Exam to Delete',
        'This will be deleted',
        'academic',
        60,
        6.5,
        true,
        'Delete instructions',
        adminUser.rows[0].id
      ]);

      const response = await request(app)
        .delete(`/api/admin/exams/${examToDeleteId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id', examToDeleteId);
      expect(response.body.data.title).toBe('Exam to Delete');

      // Verify deletion
      const deletedExam = await query('SELECT * FROM exams WHERE id = $1', [examToDeleteId]);
      expect(deletedExam.rows.length).toBe(0);
    });

    it('should fail to delete non-existent exam', async () => {
      const response = await request(app)
        .delete(`/api/admin/exams/${uuidv4()}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('not found');
    });

    it('should deny student access to delete exam', async () => {
      const response = await request(app)
        .delete(`/api/admin/exams/${testExamId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Access denied');
    });
  });

  describe('POST /api/admin/tickets', () => {
    it('should create tickets as admin', async () => {
      const ticketData = {
        examId: testExamId,
        quantity: 5,
        validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
        maxUses: 1,
        notes: 'Test tickets batch'
      };

      const response = await request(app)
        .post('/api/admin/tickets')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(ticketData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data.tickets)).toBe(true);
      expect(response.body.data.tickets.length).toBe(5);
      
      const tickets = response.body.data.tickets;
      expect(tickets[0]).toHaveProperty('ticketCode');
      expect(tickets[0].examId).toBe(testExamId);
      expect(tickets[0].status).toBe('active');
      expect(tickets[0].maxUses).toBe(1);
    });

    it('should fail to create tickets without required fields', async () => {
      const incompleteTicket = {
        // Missing examId and other required fields
      };

      const response = await request(app)
        .post('/api/admin/tickets')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(incompleteTicket)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('required');
    });

    it('should deny student access to create tickets', async () => {
      const ticketData = {
        examId: testExamId,
        quantity: 1
      };

      const response = await request(app)
        .post('/api/admin/tickets')
        .set('Authorization', `Bearer ${studentToken}`)
        .send(ticketData)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Access denied');
    });
  });

  describe('GET /api/admin/tickets', () => {
    it('should list tickets for admin', async () => {
      // Create some tickets first
      await request(app)
        .post('/api/admin/tickets')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          examId: testExamId,
          quantity: 3
        })
        .expect(201);

      const response = await request(app)
        .get('/api/admin/tickets')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.pagination).toBeDefined();
    });

    it('should support ticket filtering by status', async () => {
      const response = await request(app)
        .get('/api/admin/tickets?status=active')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      const tickets = response.body.data;
      expect(tickets.every((ticket: any) => ticket.status === 'active')).toBe(true);
    });

    it('should deny student access to ticket list', async () => {
      const response = await request(app)
        .get('/api/admin/tickets')
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Access denied');
    });
  });

  describe('Admin User Management', () => {
    it('should list all users as admin', async () => {
      const response = await request(app)
        .get('/api/admin/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.pagination).toBeDefined();
    });

    it('should update student status as admin', async () => {
      const updateData = {
        status: 'suspended'
      };

      const response = await request(app)
        .put(`/api/admin/students/${testStudentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('suspended');

      // Verify update in database
      const updatedUser = await query('SELECT status FROM users WHERE id = $1', [testStudentId]);
      expect(updatedUser.rows[0].status).toBe('suspended');
    });

    it('should fail to update non-existent student', async () => {
      const updateData = {
        status: 'inactive'
      };

      const response = await request(app)
        .put(`/api/admin/students/${uuidv4()}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(updateData)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('not found');
    });

    it('should deny student access to user management', async () => {
      const updateData = {
        status: 'inactive'
      };

      const response = await request(app)
        .put(`/api/admin/students/${testStudentId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send(updateData)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Access denied');
    });
  });

  describe('Admin Analytics', () => {
    it('should get basic analytics data', async () => {
      const response = await request(app)
        .get('/api/admin/analytics')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('totalStudents');
      expect(response.body.data).toHaveProperty('totalExams');
      expect(response.body.data).toHaveProperty('averageScore');
      expect(response.body.data).toHaveProperty('passRate');
      expect(Array.isArray(response.body.data.sectionPerformance)).toBe(true);
    });

    it('should support date range filtering for analytics', async () => {
      const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const endDate = new Date().toISOString().split('T')[0];

      const response = await request(app)
        .get(`/api/admin/analytics?startDate=${startDate}&endDate=${endDate}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.dateRange).toBeDefined();
    });

    it('should deny student access to analytics', async () => {
      const response = await request(app)
        .get('/api/admin/analytics')
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Access denied');
    });
  });

  describe('Admin Session Management', () => {
    it('should list active sessions for admin monitoring', async () => {
      // Create an active session
      const startResponse = await request(app)
        .post(`/api/exams/${testExamId}/start`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      const sessionId = startResponse.body.data.sessionId;

      const response = await request(app)
        .get('/api/admin/sessions/active')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    it('should get session results for admin', async () => {
      // Create and complete a session
      const startResponse = await request(app)
        .post(`/api/exams/${testExamId}/start`)
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      const sessionId = startResponse.body.data.sessionId;
      const answers = [{ questionId: testQuestionId, studentAnswer: 'A' }];

      await request(app)
        .post(`/api/exams/sessions/${sessionId}/submit`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ answers })
        .expect(200);

      const response = await request(app)
        .get(`/api/admin/sessions/${sessionId}/results`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('sessionId', sessionId);
      expect(response.body.data).toHaveProperty('totalScore');
      expect(response.body.data).toHaveProperty('answers');
    });

    it('should deny student access to session management', async () => {
      const response = await request(app)
        .get('/api/admin/sessions/active')
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Access denied');
    });
  });

  describe('Admin Session Results - Simple Table Normalization', () => {
    let simpleExamId: string;
    let simpleSectionId: string;
    let simpleQuestionId: string;
    let simpleSessionId: string;

    beforeAll(async () => {
      const adminRow = await query('SELECT id FROM users WHERE email = $1', ['testadmin@example.com']);
      const adminUserId = adminRow.rows[0].id;
      const studentRow = await query('SELECT id FROM users WHERE email = $1', ['teststudent@example.com']);
      const studentId = studentRow.rows[0].id;

      simpleExamId = uuidv4();
      simpleSectionId = uuidv4();
      simpleQuestionId = uuidv4();
      simpleSessionId = uuidv4();

      await testPool!.query(`
        INSERT INTO exams (id, title, description, exam_type, duration_minutes, passing_score, is_active, instructions, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        simpleExamId,
        'Simple Table Exam',
        'Exam with simple table question',
        'academic',
        60,
        6.5,
        true,
        'Simple table instructions',
        adminUserId
      ]);

      await testPool!.query(`
        INSERT INTO exam_sections (id, exam_id, section_type, title, description, duration_minutes, max_score, section_order, instructions)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        simpleSectionId,
        simpleExamId,
        'reading',
        'Simple Table Section',
        'Section for simple table question',
        30,
        10,
        1,
        'Answer the table items'
      ]);

      const metadata = {
        simpleTable: {
          rows: [
            [
              { type: 'label', text: 'Animals' },
              { type: 'question', questionType: 'fill_blank', questionNumber: 1, points: 1, correctAnswer: 'cat' },
              { type: 'question', questionType: 'fill_blank', questionNumber: 2, points: 1, correctAnswer: 'dog' }
            ]
          ]
        }
      };

      await testPool!.query(`
        INSERT INTO exam_questions (id, section_id, question_type, question_text, question_number, points, correct_answer, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        simpleQuestionId,
        simpleSectionId,
        'simple_table',
        'Fill the animal names',
        1,
        2,
        null,
        JSON.stringify(metadata)
      ]);

      await testPool!.query(`
        INSERT INTO exam_sessions (id, user_id, exam_id, status, started_at, submitted_at, total_score, percentage_score)
        VALUES ($1, $2, $3, 'submitted', NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '5 minutes', $4, $5)
      `, [
        simpleSessionId,
        studentId,
        simpleExamId,
        2,
        100
      ]);

      const simpleAnswerPayload = { cells: { '0_1': 'cat', '0_2': 'dog' } };
      await testPool!.query(`
        INSERT INTO exam_session_answers (id, session_id, question_id, student_answer, answered_at, is_correct, points_earned)
        VALUES ($1, $2, $3, $4, NOW(), $5, $6)
      `, [
        uuidv4(),
        simpleSessionId,
        simpleQuestionId,
        JSON.stringify(simpleAnswerPayload),
        true,
        2
      ]);
    });

    it('should expand simple table answers with graded entries', async () => {
      const response = await request(app)
        .get(`/api/admin/sessions/${simpleSessionId}/results`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      const { answers } = response.body.data;
      expect(Array.isArray(answers)).toBe(true);

      const tableAnswer = answers.find((entry: any) => entry.questionType === 'simple_table');
      expect(tableAnswer).toBeDefined();
      expect(tableAnswer.studentAnswer).toBeDefined();
      expect(tableAnswer.studentAnswer.type).toBe('simple_table');
      expect(Array.isArray(tableAnswer.studentAnswer.graded)).toBe(true);
      expect(tableAnswer.studentAnswer.graded.length).toBe(2);
      const correctCount = tableAnswer.studentAnswer.graded.filter((item: any) => item.isCorrect).length;
      expect(correctCount).toBe(2);
    });
  });

  afterAll(async () => {
    // Comprehensive cleanup
    await testPool!.query('DELETE FROM admin_logs');
    await testPool!.query('DELETE FROM exam_session_answers');
    await testPool!.query('DELETE FROM exam_sessions');
    await testPool!.query('DELETE FROM ticket_usage');
    await testPool!.query('DELETE FROM tickets');
    await testPool!.query('DELETE FROM exam_question_options');
    await testPool!.query('DELETE FROM exam_questions');
    await testPool!.query('DELETE FROM exam_sections');
    await testPool!.query('DELETE FROM exams WHERE created_by IN (SELECT id FROM users WHERE email LIKE \'%@example.com\')');
    await testPool!.query('DELETE FROM users WHERE email LIKE \'%@example.com\'');
  });
});