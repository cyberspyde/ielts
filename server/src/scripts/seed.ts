import { db, logger } from '../config/database-no-redis';

async function seed(): Promise<void> {
  try {
    logger.info('Seeding database with sample data...');

    // Ensure admin exists (password hash corresponds to 'admin123' as in setup SQL)
    await db.query(`
      INSERT INTO users (email, password_hash, first_name, last_name, role, status, email_verified)
      VALUES ($1, $2, $3, $4, 'super_admin', 'active', true)
      ON CONFLICT (email) DO NOTHING
    `, ['admin@bestcenter.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj3qUkzs0eC6', 'System', 'Administrator']);

    // Create a sample exam if none exists
    const exists = await db.query('SELECT id FROM exams LIMIT 1');
    if (exists.rowCount === 0) {
      const admin = await db.query('SELECT id FROM users WHERE email = $1', ['admin@bestcenter.com']);
      const adminId = admin.rows[0]?.id;
      const exam = await db.query(`
        INSERT INTO exams (title, description, exam_type, duration_minutes, passing_score, instructions, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
      `, [
        'IELTS Academic Practice Test 1',
        'Complete IELTS Academic practice test with all four sections',
        'academic',
        180,
        6.5,
        'This is a complete IELTS Academic test. You have 3 hours to complete all sections.',
        adminId
      ]);
      const examId = exam.rows[0].id;
      await db.query(`
        INSERT INTO exam_sections (exam_id, section_type, title, description, duration_minutes, max_score, section_order, instructions)
        VALUES 
        ($1,'listening','Listening Section','IELTS Listening test with 4 parts',30,9.0,1,'Listen and answer the questions'),
        ($1,'reading','Reading Section','IELTS Reading test with 3 passages',60,9.0,2,'Read and answer the questions')
      `, [examId]);
    }

    logger.info('Seeding complete');
  } catch (err) {
    logger.error('Seeding failed', err as any);
    process.exit(1);
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  seed();
}

export { seed };


