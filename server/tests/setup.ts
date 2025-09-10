// server/tests/setup.ts
import { Pool, Client } from 'pg';
import { db } from '../src/config/database-no-redis';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { logger } from '../src/config/database-no-redis';

const TEST_DB_NAME = process.env.TEST_DB_NAME || 'ielts_platform_test';
const TEST_DB_USER = process.env.TEST_DB_USER || 'postgres';
const TEST_DB_PASSWORD = process.env.TEST_DB_PASSWORD || 'postgres';
const TEST_DB_HOST = process.env.TEST_DB_HOST || 'localhost';
const TEST_DB_PORT = parseInt(process.env.TEST_DB_PORT || '5432');

// Admin client for creating/dropping test database
const adminClient = new Client({
  user: TEST_DB_USER,
  host: TEST_DB_HOST,
  database: 'postgres', // Connect to default postgres db first
  password: TEST_DB_PASSWORD,
  port: TEST_DB_PORT,
});

// Test database pool (will be updated after test DB creation)
let testPool: Pool | null = null;

// Migration files directory
const MIGRATIONS_DIR = path.join(__dirname, '../src/migrations');

// Global test setup
beforeAll(async () => {
  try {
    await adminClient.connect();
    logger.info('Connected to admin database for test setup');

    // Check if test database exists
    const dbExists = await adminClient.query(
      `SELECT 1 FROM pg_database WHERE datname = '${TEST_DB_NAME}'`
    );

    if (dbExists.rowCount === 0) {
      // Create test database
      await adminClient.query(`CREATE DATABASE "${TEST_DB_NAME}"`);
      logger.info(`Created test database: ${TEST_DB_NAME}`);
    } else {
      logger.info(`Test database ${TEST_DB_NAME} already exists`);
    }

    // Close admin client
    await adminClient.end();

    // Create test pool connected to test database
    testPool = new Pool({
      user: TEST_DB_USER,
      host: TEST_DB_HOST,
      database: TEST_DB_NAME,
      password: TEST_DB_PASSWORD,
      port: TEST_DB_PORT,
    });

    // Test connection to test database
    const testConn = await testPool.query('SELECT NOW()');
    logger.info('Connected to test database successfully');

    // Run migrations
    await runMigrations();
    
  } catch (error) {
    logger.error('Test setup failed:', error);
    throw error;
  }
});

// Run database migrations
async function runMigrations() {
  if (!testPool) {
    throw new Error('Test pool not initialized');
  }

  const migrationFiles = fs.readdirSync(MIGRATIONS_DIR)
    .filter(file => file.endsWith('.sql'))
    .sort()
    .map(file => path.join(MIGRATIONS_DIR, file));

  for (const migrationFile of migrationFiles) {
    try {
      const migrationContent = fs.readFileSync(migrationFile, 'utf8');
      await testPool.query(migrationContent);
      logger.info(`Applied migration: ${path.basename(migrationFile)}`);
    } catch (error) {
      logger.warn(`Migration ${path.basename(migrationFile)} may have already been applied or failed:`, error);
      // Continue with next migration
    }
  }

  logger.info('All migrations applied successfully');
}

// Global beforeEach - Clear tables before each test for isolation
beforeEach(async () => {
  if (!testPool) {
    throw new Error('Test pool not available');
  }

  // List of tables to truncate (in reverse dependency order)
  const tablesToClear = [
    'exam_session_answers',
    'exam_sessions',
    'ticket_usage',
    'user_sessions',
    'tickets',
    'exam_question_options',
    'exam_questions',
    'exam_sections',
    'exams',
    'admin_logs',
    'users',
    'system_settings'
  ];

  for (const table of tablesToClear) {
    try {
      await testPool.query(`TRUNCATE TABLE ${table} CASCADE`);
    } catch (error) {
      // Table might not exist yet, continue
      logger.debug(`Table ${table} not found for truncation`);
    }
  }

  logger.debug('Test database cleared for new test');
});

// Global afterEach - Check for open connections
afterEach(async () => {
  if (testPool) {
    // Check for idle connections and end them
    const idleQuery = await testPool.query(`
      SELECT pid FROM pg_stat_activity 
      WHERE datname = '${TEST_DB_NAME}' 
      AND state = 'idle' 
      AND query_start < NOW() - INTERVAL '5 minutes'
    `);

    if (idleQuery.rows && idleQuery.rows.length > 0) {
      logger.warn(`${idleQuery.rows.length} idle connections found and will be terminated`);
    }
  }
});

// Global afterAll - Cleanup
afterAll(async () => {
  if (testPool) {
    await testPool.end();
    logger.info('Test database pool closed');
  }

  // Optional: Drop test database (uncomment for full cleanup)
  // try {
  //   const adminClient = new Client({
  //     user: TEST_DB_USER,
  //     host: TEST_DB_HOST,
  //     database: 'postgres',
  //     password: TEST_DB_PASSWORD,
  //     port: TEST_DB_PORT,
  //   });
  //   await adminClient.connect();
  //   await adminClient.query(`DROP DATABASE IF EXISTS "${TEST_DB_NAME}"`);
  //   await adminClient.end();
  //   logger.info(`Dropped test database: ${TEST_DB_NAME}`);
  // } catch (error) {
  //   logger.error('Failed to drop test database:', error);
  // }
});

// Export test database utilities
export {
  testPool,
  runMigrations,
  TEST_DB_NAME,
  TEST_DB_USER,
  TEST_DB_HOST,
  TEST_DB_PORT,
};

// Override the main db import for tests
jest.mock('../src/config/database-no-redis', () => ({
  ...jest.requireActual('../src/config/database-no-redis'),
  db: testPool,
}));

// Utility function to seed test data
export async function seedTestData() {
  if (!testPool) {
    throw new Error('Test pool not available');
  }

  // Create test admin user
  await testPool.query(`
    INSERT INTO users (id, email, password_hash, first_name, last_name, role, status, email_verified, created_at)
    VALUES (
      gen_random_uuid(),
      'testadmin@example.com',
      '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
      'Test',
      'Admin',
      'super_admin',
      'active',
      true,
      NOW()
    )
  `);

  // Create test student user
  await testPool.query(`
    INSERT INTO users (id, email, password_hash, first_name, last_name, role, status, email_verified, created_at)
    VALUES (
      gen_random_uuid(),
      'teststudent@example.com',
      '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
      'Test',
      'Student',
      'student',
      'active',
      true,
      NOW()
    )
  `);

  logger.info('Test data seeded successfully');
}

// Utility function to get test admin token (simplified for testing)
export async function getTestAdminToken() {
  // In real tests, this would involve proper JWT creation
  // For now, return a mock token
  return 'mock-admin-jwt-token-for-testing';
}

export async function getTestStudentToken() {
  return 'mock-student-jwt-token-for-testing';
}