
// server/tests/auth.test.ts
import request from 'supertest';
import { app } from '../src/index';
import { seedTestData, testPool } from './setup';
import { query } from '../src/config/database-no-redis';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { logger } from '../src/config/database-no-redis';

// Mock JWT secret for consistent testing
process.env.JWT_SECRET = 'test-jwt-secret-for-testing';

describe('Authentication Tests', () => {
  beforeAll(async () => {
    await seedTestData();
  });

  afterEach(async () => {
    // Clean up any test users created during tests
    await testPool!.query(`
      DELETE FROM users WHERE email LIKE '%@example.com' AND email != 'testadmin@example.com' AND email != 'teststudent@example.com'
    `);
  });

  describe('POST /api/auth/register', () => {
    it('should register a new student user successfully', async () => {
      const newUser = {
        email: 'newstudent@example.com',
        password: 'password123',
        firstName: 'New',
        lastName: 'Student'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(newUser)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('user');
      expect(response.body.data.user.email).toBe(newUser.email);
      expect(response.body.data.user.role).toBe('student');
      expect(response.body.data.user.status).toBe('active');
      expect(response.body.data.token).toBeDefined();

      // Verify user was created in database
      const dbUser = await query('SELECT * FROM users WHERE email = $1', [newUser.email]);
      expect(dbUser.rows.length).toBe(1);
      expect(dbUser.rows[0].first_name).toBe(newUser.firstName);
      expect(dbUser.rows[0].last_name).toBe(newUser.lastName);
      expect(dbUser.rows[0].email_verified).toBe(false); // Default is false

      // Verify password is hashed
      const isValidPassword = await bcrypt.compare(newUser.password, dbUser.rows[0].password_hash);
      expect(isValidPassword).toBe(true);
    });

    it('should fail to register with duplicate email', async () => {
      const duplicateUser = {
        email: 'teststudent@example.com', // Already seeded
        password: 'password123',
        firstName: 'Duplicate',
        lastName: 'Student'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(duplicateUser)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('already exists');
    });

    it('should fail to register with invalid email', async () => {
      const invalidUser = {
        email: 'invalid-email',
        password: 'password123',
        firstName: 'Invalid',
        lastName: 'User'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(invalidUser)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Valid email');
    });

    it('should fail to register with missing required fields', async () => {
      const incompleteUser = {
        // Missing all fields
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(incompleteUser)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('required');
    });

    it('should fail to register with weak password', async () => {
      const weakPasswordUser = {
        email: 'weakpass@example.com',
        password: '123', // Too short
        firstName: 'Weak',
        lastName: 'Password'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(weakPasswordUser)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Password must be at least');
    });
  });

  describe('POST /api/auth/login', () => {
    it('should login with valid student credentials', async () => {
      const loginData = {
        email: 'teststudent@example.com',
        password: 'password123'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('user');
      expect(response.body.data.user.email).toBe(loginData.email);
      expect(response.body.data.token).toBeDefined();

      // Verify token contains correct user info
      const decoded = jwt.verify(response.body.data.token, process.env.JWT_SECRET!) as any;
      expect(decoded.email).toBe(loginData.email);
      expect(decoded.role).toBe('student');
      expect(decoded.status).toBe('active');
    });

    it('should login with valid admin credentials', async () => {
      const loginData = {
        email: 'testadmin@example.com',
        password: 'password123'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.role).toBe('super_admin');
      expect(response.body.data.token).toBeDefined();

      // Verify token has admin role
      const decoded = jwt.verify(response.body.data.token, process.env.JWT_SECRET!) as any;
      expect(decoded.role).toBe('super_admin');
    });

    it('should fail to login with invalid password', async () => {
      const invalidLogin = {
        email: 'teststudent@example.com',
        password: 'wrongpassword'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(invalidLogin)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Invalid credentials');
    });

    it('should fail to login with non-existent user', async () => {
      const nonExistentLogin = {
        email: 'nonexistent@example.com',
        password: 'password123'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(nonExistentLogin)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Invalid credentials');
    });

    it('should fail to login with inactive user', async () => {
      // Create inactive user for testing
      const inactiveUserId = (await testPool!.query('SELECT gen_random_uuid() as id')).rows[0].id;
      const hashedPassword = await bcrypt.hash('password123', 12);
      
      await testPool!.query(`
        INSERT INTO users (id, email, password_hash, first_name, last_name, role, status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      `, [
        inactiveUserId,
        'inactive@example.com',
        hashedPassword,
        'Inactive',
        'User',
        'student',
        'inactive'
      ]);

      const inactiveLogin = {
        email: 'inactive@example.com',
        password: 'password123'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(inactiveLogin)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Account is not active');
    });

    it('should fail to login with missing credentials', async () => {
      const incompleteLogin = {
        // Missing email and password
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(incompleteLogin)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('required');
    });
  });

  describe('GET /api/auth/me', () => {
    it('should get current user with valid token', async () => {
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'teststudent@example.com',
          password: 'password123'
        })
        .expect(200);

      const token = loginResponse.body.data.token;

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.email).toBe('teststudent@example.com');
      expect(response.body.data.role).toBe('student');
    });

    it('should fail to get current user with invalid token', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Invalid token');
    });

    it('should fail to get current user without token', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Authentication required');
    });

    it('should return user profile with all fields', async () => {
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'testadmin@example.com',
          password: 'password123'
        })
        .expect(200);

      const token = loginResponse.body.data.token;

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data).toHaveProperty('email');
      expect(response.body.data).toHaveProperty('firstName');
      expect(response.body.data).toHaveProperty('lastName');
      expect(response.body.data).toHaveProperty('role');
      expect(response.body.data).toHaveProperty('status');
      expect(response.body.data.createdAt).toBeDefined();
    });
  });

  describe('Role-based Access Control', () => {
    it('should allow admin access to admin routes', async () => {
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'testadmin@example.com',
          password: 'password123'
        })
        .expect(200);

      const adminToken = loginResponse.body.data.token;

      const response = await request(app)
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should deny student access to admin routes', async () => {
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'teststudent@example.com',
          password: 'password123'
        })
        .expect(200);

      const studentToken = loginResponse.body.data.token;

      const response = await request(app)
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Access denied');
    });

    it('should allow student access to student routes', async () => {
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'teststudent@example.com',
          password: 'password123'
        })
        .expect(200);

      const studentToken = loginResponse.body.data.token;

      const response = await request(app)
        .get('/api/exams')
        .set('Authorization', `Bearer ${studentToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('Token Handling', () => {
    it('should handle expired token', async () => {
      // Create a token with expired date
      const expiredPayload = {
        email: 'teststudent@example.com',
        role: 'student',
        iat: Math.floor(Date.now() / 1000) - 1000,
        exp: Math.floor(Date.now() / 1000) - 100
      };

      const expiredToken = jwt.sign(expiredPayload, process.env.JWT_SECRET!);

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Token expired');
    });

    it('should handle malformed token', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer malformed.token.here')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Invalid token');
    });
  });

  afterAll(async () => {
    // Clean up any remaining test data
    await testPool!.query(`
      DELETE FROM users WHERE email LIKE '%@example.com'
    `);
    
    // Reset environment
    delete process.env.JWT_SECRET;
  });
});