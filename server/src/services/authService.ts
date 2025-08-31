import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { query, sessionHelpers, logger } from '../config/database-no-redis';
import { AppError } from '../middleware/errorHandler';

interface User {
  id: string;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  role: string;
  status: string;
  email_verified: boolean;
}

interface LoginResult {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    status: string;
    emailVerified: boolean;
  };
  accessToken: string;
  refreshToken: string;
}

interface RegisterResult {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    status: string;
    emailVerified: boolean;
  };
  accessToken: string;
  refreshToken: string;
}

// Generate JWT tokens
const generateTokens = (userId: string, email: string, role: string): { accessToken: string; refreshToken: string } => {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new AppError('JWT secret not configured', 500);
  }

  const accessToken = (jwt as any).sign(
    { userId, email, role },
    jwtSecret,
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
  );

  const refreshToken = (jwt as any).sign(
    { userId, email, role, type: 'refresh' },
    jwtSecret,
    { expiresIn: '7d' }
  );

  return { accessToken, refreshToken };
};

// Sanitize user data for response
const sanitizeUser = (user: User) => ({
  id: user.id,
  email: user.email,
  firstName: user.first_name,
  lastName: user.last_name,
  role: user.role,
  status: user.status,
  emailVerified: user.email_verified
});

// User registration
export const registerUser = async (
  email: string,
  password: string,
  firstName: string,
  lastName: string,
  phone?: string,
  dateOfBirth?: string,
  nationality?: string
): Promise<RegisterResult> => {
  // Check if user already exists
  const existingUser = await query('SELECT id FROM users WHERE email = $1', [email]);
  if (existingUser.rows.length > 0) {
    throw new AppError('User with this email already exists', 409);
  }

  // Hash password
  const saltRounds = 12;
  const passwordHash = await bcrypt.hash(password, saltRounds);

  // Create user
  const result = await query(`
    INSERT INTO users (email, password_hash, first_name, last_name, phone, date_of_birth, nationality, role, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'student', 'active')
    RETURNING id, email, first_name, last_name, role, status, email_verified
  `, [email, passwordHash, firstName, lastName, phone, dateOfBirth, nationality]);

  const user = result.rows[0];
  const { accessToken, refreshToken } = generateTokens(user.id, user.email, user.role);

  // Store refresh token in session
  await sessionHelpers.setSession(refreshToken, user.id, { token: refreshToken });

  logger.info('User registered successfully', {
    userId: user.id,
    email: user.email,
    role: user.role
  });

  return {
    user: sanitizeUser(user),
    accessToken,
    refreshToken
  };
};

// User login
export const loginUser = async (email: string, password: string): Promise<LoginResult> => {
  // Find user by email
  const result = await query(`
    SELECT id, email, password_hash, first_name, last_name, role, status, email_verified
    FROM users 
    WHERE email = $1
  `, [email]);

  if (result.rows.length === 0) {
    throw new AppError('Invalid email or password', 401);
  }

  const user = result.rows[0];

  // Check if user is active
  if (user.status !== 'active') {
    throw new AppError('Account is not active', 401);
  }

  // Verify password
  const isPasswordValid = await bcrypt.compare(password, user.password_hash);
  if (!isPasswordValid) {
    throw new AppError('Invalid email or password', 401);
  }

  // Generate tokens
  const { accessToken, refreshToken } = generateTokens(user.id, user.email, user.role);

  // Store refresh token in session
  await sessionHelpers.setSession(refreshToken, user.id, { token: refreshToken });

  // Update last login
  await query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);

  logger.info('User logged in successfully', {
    userId: user.id,
    email: user.email,
    role: user.role
  });

  return {
    user: sanitizeUser(user),
    accessToken,
    refreshToken
  };
};

// Refresh token
export const refreshToken = async (refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> => {
  try {
    if (!process.env.JWT_SECRET) {
      throw new AppError('JWT secret not configured', 500);
    }

    // Verify refresh token
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new AppError('JWT secret not configured', 500);
    }
    const decoded = (jwt as any).verify(refreshToken, jwtSecret);
    
    if (!decoded.userId || !decoded.email || !decoded.role || decoded.type !== 'refresh') {
      throw new AppError('Invalid refresh token', 401);
    }

    // Check if refresh token exists in session
    const session = await sessionHelpers.getSession(refreshToken);
    if (!session || session.userId !== decoded.userId) {
      throw new AppError('Invalid refresh token', 401);
    }

    // Check if user still exists and is active
    const userResult = await query(`
      SELECT id, email, role, status 
      FROM users 
      WHERE id = $1 AND status = 'active'
    `, [decoded.userId]);

    if (userResult.rows.length === 0) {
      await sessionHelpers.deleteSession(refreshToken);
      throw new AppError('User not found or inactive', 401);
    }

    const user = userResult.rows[0];

    // Generate new tokens
    const newTokens = generateTokens(user.id, user.email, user.role);

    // Remove old refresh token and store new one
    await sessionHelpers.deleteSession(refreshToken);
    await sessionHelpers.setSession(newTokens.refreshToken, user.id, { token: newTokens.refreshToken });

    logger.info('Token refreshed successfully', {
      userId: user.id,
      email: user.email
    });

    return newTokens;
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      throw new AppError('Invalid refresh token', 401);
    }
    throw error;
  }
};

// Logout user
export const logoutUser = async (refreshToken: string): Promise<void> => {
  try {
    // Remove refresh token from session
    await sessionHelpers.deleteSession(refreshToken);

    logger.info('User logged out successfully');
  } catch (error) {
    logger.error('Error during logout:', error);
    // Don't throw error for logout failures
  }
};

// Change password
export const changePassword = async (userId: string, currentPassword: string, newPassword: string): Promise<void> => {
  // Get current password hash
  const result = await query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (result.rows.length === 0) {
    throw new AppError('User not found', 404);
  }

  const currentHash = result.rows[0].password_hash;

  // Verify current password
  const isCurrentPasswordValid = await bcrypt.compare(currentPassword, currentHash);
  if (!isCurrentPasswordValid) {
    throw new AppError('Current password is incorrect', 400);
  }

  // Hash new password
  const saltRounds = 12;
  const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

  // Update password
  await query('UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newPasswordHash, userId]);

  logger.info('Password changed successfully', { userId });
};

// Reset password (for admin use)
export const resetPassword = async (userId: string, newPassword: string): Promise<void> => {
  // Check if user exists
  const userCheck = await query('SELECT email FROM users WHERE id = $1', [userId]);
  if (userCheck.rows.length === 0) {
    throw new AppError('User not found', 404);
  }

  // Hash new password
  const saltRounds = 12;
  const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

  // Update password
  await query('UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newPasswordHash, userId]);

  logger.info('Password reset by admin', { userId, email: userCheck.rows[0].email });
};

// Verify email
export const verifyEmail = async (userId: string): Promise<void> => {
  const result = await query(`
    UPDATE users 
    SET email_verified = true, updated_at = CURRENT_TIMESTAMP 
    WHERE id = $1 
    RETURNING email
  `, [userId]);

  if (result.rows.length === 0) {
    throw new AppError('User not found', 404);
  }

  logger.info('Email verified successfully', { userId, email: result.rows[0].email });
};

// Get user by ID
export const getUserById = async (userId: string) => {
  const result = await query(`
    SELECT id, email, first_name, last_name, phone, date_of_birth, 
           nationality, role, status, email_verified, created_at, last_login
    FROM users 
    WHERE id = $1
  `, [userId]);

  if (result.rows.length === 0) {
    throw new AppError('User not found', 404);
  }

  return sanitizeUser(result.rows[0]);
};

// Update user profile
export const updateUserProfile = async (
  userId: string,
  updates: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    dateOfBirth?: string;
    nationality?: string;
  }
): Promise<any> => {
  const updateFields = [];
  const values = [];
  let paramCount = 1;

  if (updates.firstName !== undefined) {
    updateFields.push(`first_name = $${paramCount++}`);
    values.push(updates.firstName);
  }
  if (updates.lastName !== undefined) {
    updateFields.push(`last_name = $${paramCount++}`);
    values.push(updates.lastName);
  }
  if (updates.phone !== undefined) {
    updateFields.push(`phone = $${paramCount++}`);
    values.push(updates.phone);
  }
  if (updates.dateOfBirth !== undefined) {
    updateFields.push(`date_of_birth = $${paramCount++}`);
    values.push(updates.dateOfBirth);
  }
  if (updates.nationality !== undefined) {
    updateFields.push(`nationality = $${paramCount++}`);
    values.push(updates.nationality);
  }

  if (updateFields.length === 0) {
    throw new AppError('No fields to update', 400);
  }

  updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(userId);

  const result = await query(`
    UPDATE users 
    SET ${updateFields.join(', ')}
    WHERE id = $${paramCount}
    RETURNING id, email, first_name, last_name, phone, date_of_birth, nationality, role, status, email_verified
  `, values);

  if (result.rows.length === 0) {
    throw new AppError('User not found', 404);
  }

  logger.info('User profile updated', { userId, updatedFields: Object.keys(updates) });

  return sanitizeUser(result.rows[0]);
};