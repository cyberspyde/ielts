
// server/tests/exam-flow.e2e.test.ts
import request from 'supertest';
import { app } from '../src/index';
import { seedTestData, testPool } from './setup';
import { v4 as uuidv4 } from 'uuid';

describe('End-to-End Exam Flow Tests', () => {
  let adminToken: string;
  let studentToken: string;
  let testExamId: string;
  let testSectionId: string;
  let testQuestionId: string;

  beforeAll(async () => {
    await seedTestData();
    
    // Login as admin to create test data
    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'testadmin@example.com',
        password: 'password123'
      })
      .expect(200);

    adminToken = adminLogin.body.data.token;

    // Create test student if needed (should be created by seed, but ensure)
    const studentResult = await testPool!.query('SELECT id FROM users WHERE email = $1', ['teststudent@example.com']);
    if (studentResult.rows.length === 0) {
      await testPool!.query(`
        INSERT INTO users (id, email, password_hash, first_name, last_name, role, status, email_verified, created_at)
        VALUES (gen_random_uuid(), $1, $2, 'Test', 'Student', 'student', 'active', true, NOW())
      `, ['teststudent@example.com', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi']);
    }

    const adminUser = await testPool!.query('SELECT id FROM users WHERE email = $1', ['testadmin@example.com']);
    const adminUserId = adminUser.rows[0].id;

    // Create test exam
    const examResult = await testPool!.query(`
      INSERT INTO exams (id, title, description, exam_type, duration_minutes, passing_score, is_active, instructions, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id
    `, [
      uuidv4(),
      'E2E Test Exam',
      'End-to-end test exam',
      'academic',
      60,
      6.5,
      true,
      'E2E test instructions',
      adminUserId
    ]);
    testExamId = examResult.rows[0].id;

    // Create test section
    const sectionResult = await testPool!.query(`
      INSERT INTO exam_sections (id,