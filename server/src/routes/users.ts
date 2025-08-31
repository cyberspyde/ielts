import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { query, logger } from '../config/database';
import { asyncHandler, createValidationError, createNotFoundError, AppError } from '../middleware/errorHandler';
import { requireOwnershipOrAdmin, requireUserManagementPermission, rateLimitByUser } from '../middleware/auth';

const router = Router();

// Helper function to check validation errors
const checkValidationErrors = (req: Request): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw createValidationError(errors.array());
  }
};

// Validation middleware
const validateUserUpdate = [
  body('firstName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be 2-50 characters'),
  body('lastName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be 2-50 characters'),
  body('phone')
    .optional()
    .isMobilePhone('any')
    .withMessage('Invalid phone number'),
  body('dateOfBirth')
    .optional()
    .isISO8601()
    .withMessage('Invalid date format'),
  body('nationality')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Nationality too long'),
  body('preferredLanguage')
    .optional()
    .isIn(['en', 'es', 'fr', 'de', 'zh', 'ar'])
    .withMessage('Invalid language'),
  body('timezone')
    .optional()
    .isLength({ max: 50 })
    .withMessage('Invalid timezone'),
];

// GET /api/users/profile - Get current user profile
router.get('/profile',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;

    const userResult = await query(`
      SELECT id, email, first_name, last_name, phone, date_of_birth, 
             nationality, profile_image_url, preferred_language, timezone,
             role, status, email_verified, created_at, last_login
      FROM users 
      WHERE id = $1
    `, [userId]);

    if (userResult.rows.length === 0) {
      throw createNotFoundError('User');
    }

    const user = userResult.rows[0];
    const sanitizedUser = {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      phone: user.phone,
      dateOfBirth: user.date_of_birth,
      nationality: user.nationality,
      profileImageUrl: user.profile_image_url,
      preferredLanguage: user.preferred_language,
      timezone: user.timezone,
      role: user.role,
      status: user.status,
      emailVerified: user.email_verified,
      createdAt: user.created_at,
      lastLogin: user.last_login
    };

    res.json({
      success: true,
      data: { user: sanitizedUser }
    });
  })
);

// PUT /api/users/profile - Update current user profile
router.put('/profile',
  rateLimitByUser(10, 60), // 10 updates per hour
  validateUserUpdate,
  asyncHandler(async (req: Request, res: Response) => {
    checkValidationErrors(req);

    const userId = req.user!.id;
    const {
      firstName,
      lastName,
      phone,
      dateOfBirth,
      nationality,
      preferredLanguage,
      timezone
    } = req.body;

    // Build dynamic update query
    const updateFields = [];
    const values = [];
    let paramCount = 1;

    if (firstName !== undefined) {
      updateFields.push(`first_name = $${paramCount++}`);
      values.push(firstName);
    }
    if (lastName !== undefined) {
      updateFields.push(`last_name = $${paramCount++}`);
      values.push(lastName);
    }
    if (phone !== undefined) {
      updateFields.push(`phone = $${paramCount++}`);
      values.push(phone);
    }
    if (dateOfBirth !== undefined) {
      updateFields.push(`date_of_birth = $${paramCount++}`);
      values.push(dateOfBirth);
    }
    if (nationality !== undefined) {
      updateFields.push(`nationality = $${paramCount++}`);
      values.push(nationality);
    }
    if (preferredLanguage !== undefined) {
      updateFields.push(`preferred_language = $${paramCount++}`);
      values.push(preferredLanguage);
    }
    if (timezone !== undefined) {
      updateFields.push(`timezone = $${paramCount++}`);
      values.push(timezone);
    }

    if (updateFields.length === 0) {
      throw new AppError('No fields to update', 400);
    }

    // Add updated_at and user ID
    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(userId);

    const updateQuery = `
      UPDATE users 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount}
      RETURNING id, first_name, last_name, phone, date_of_birth, 
                nationality, preferred_language, timezone, updated_at
    `;

    const result = await query(updateQuery, values);

    if (result.rows.length === 0) {
      throw createNotFoundError('User');
    }

    const updatedUser = result.rows[0];

    logger.info('User profile updated', {
      userId,
      email: req.user!.email,
      updatedFields: Object.keys(req.body)
    });

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: {
          id: updatedUser.id,
          firstName: updatedUser.first_name,
          lastName: updatedUser.last_name,
          phone: updatedUser.phone,
          dateOfBirth: updatedUser.date_of_birth,
          nationality: updatedUser.nationality,
          preferredLanguage: updatedUser.preferred_language,
          timezone: updatedUser.timezone,
          updatedAt: updatedUser.updated_at
        }
      }
    });
  })
);

// GET /api/users/:id - Get user by ID (admin only or self)
router.get('/:id',
  requireOwnershipOrAdmin('id'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    const userResult = await query(`
      SELECT id, email, first_name, last_name, phone, date_of_birth,
             nationality, role, status, email_verified, created_at, last_login
      FROM users 
      WHERE id = $1
    `, [id]);

    if (userResult.rows.length === 0) {
      throw createNotFoundError('User');
    }

    const user = userResult.rows[0];
    const sanitizedUser = {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      phone: user.phone,
      dateOfBirth: user.date_of_birth,
      nationality: user.nationality,
      role: user.role,
      status: user.status,
      emailVerified: user.email_verified,
      createdAt: user.created_at,
      lastLogin: user.last_login
    };

    res.json({
      success: true,
      data: { user: sanitizedUser }
    });
  })
);

// PUT /api/users/:id/status - Update user status (admin only)
router.put('/:id/status',
  requireUserManagementPermission,
  body('status')
    .isIn(['active', 'inactive', 'suspended'])
    .withMessage('Invalid status'),
  body('reason')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Reason too long'),
  asyncHandler(async (req: Request, res: Response) => {
    checkValidationErrors(req);

    const { id } = req.params;
    const { status, reason } = req.body;

    // Check if user exists
    const userCheck = await query('SELECT email, role FROM users WHERE id = $1', [id]);
    if (userCheck.rows.length === 0) {
      throw createNotFoundError('User');
    }

    const targetUser = userCheck.rows[0];

    // Prevent changing super admin status unless you are super admin
    if (targetUser.role === 'super_admin' && req.user!.role !== 'super_admin') {
      throw new AppError('Cannot modify super admin status', 403);
    }

    // Update status
    const result = await query(
      'UPDATE users SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING status',
      [status, id]
    );

    // Log admin action
    await query(`
      INSERT INTO admin_logs (user_id, action, resource_type, resource_id, details)
      VALUES ($1, $2, $3, $4, $5)
    `, [
      req.user!.id,
      'UPDATE_USER_STATUS',
      'user',
      id,
      JSON.stringify({ newStatus: status, reason, targetEmail: targetUser.email })
    ]);

    logger.info('User status updated by admin', {
      adminId: req.user!.id,
      targetUserId: id,
      targetEmail: targetUser.email,
      newStatus: status,
      reason
    });

    res.json({
      success: true,
      message: `User status updated to ${status}`,
      data: { status: result.rows[0].status }
    });
  })
);

// DELETE /api/users/:id - Delete user (super admin only)
router.delete('/:id',
  requireUserManagementPermission,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    // Check if user exists and get info
    const userCheck = await query('SELECT email, role FROM users WHERE id = $1', [id]);
    if (userCheck.rows.length === 0) {
      throw createNotFoundError('User');
    }

    const targetUser = userCheck.rows[0];

    // Prevent deleting super admin unless you are super admin
    if (targetUser.role === 'super_admin' && req.user!.role !== 'super_admin') {
      throw new AppError('Cannot delete super admin account', 403);
    }

    // Prevent self-deletion
    if (id === req.user!.id) {
      throw new AppError('Cannot delete your own account', 400);
    }

    // Delete user (cascade will handle related records)
    await query('DELETE FROM users WHERE id = $1', [id]);

    // Log admin action
    await query(`
      INSERT INTO admin_logs (user_id, action, resource_type, resource_id, details)
      VALUES ($1, $2, $3, $4, $5)
    `, [
      req.user!.id,
      'DELETE_USER',
      'user',
      id,
      JSON.stringify({ deletedEmail: targetUser.email, deletedRole: targetUser.role })
    ]);

    logger.warn('User deleted by admin', {
      adminId: req.user!.id,
      deletedUserId: id,
      deletedEmail: targetUser.email,
      deletedRole: targetUser.role
    });

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  })
);

// GET /api/users/:id/exam-history - Get user's exam history
router.get('/:id/exam-history',
  requireOwnershipOrAdmin('id'),
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const offset = (Number(page) - 1) * Number(limit);

    // Get exam sessions with exam details
    const sessionsResult = await query(`
      SELECT 
        es.id, es.status, es.started_at, es.submitted_at, es.total_score,
        es.percentage_score, es.is_passed, es.time_spent_seconds,
        e.title as exam_title, e.exam_type, e.duration_minutes
      FROM exam_sessions es
      JOIN exams e ON es.exam_id = e.id
      WHERE es.user_id = $1
      ORDER BY es.created_at DESC
      LIMIT $2 OFFSET $3
    `, [id, limit, offset]);

    // Get total count
    const countResult = await query(
      'SELECT COUNT(*) FROM exam_sessions WHERE user_id = $1',
      [id]
    );

    const sessions = sessionsResult.rows.map((session: any) => ({
      id: session.id,
      status: session.status,
      startedAt: session.started_at,
      submittedAt: session.submitted_at,
      totalScore: session.total_score,
      percentageScore: session.percentage_score,
      isPassed: session.is_passed,
      timeSpentSeconds: session.time_spent_seconds,
      exam: {
        title: session.exam_title,
        type: session.exam_type,
        durationMinutes: session.duration_minutes
      }
    }));

    const totalCount = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalCount / Number(limit));

    res.json({
      success: true,
      data: {
        sessions,
        pagination: {
          currentPage: Number(page),
          totalPages,
          totalCount,
          hasNext: Number(page) < totalPages,
          hasPrev: Number(page) > 1
        }
      }
    });
  })
);

export default router;