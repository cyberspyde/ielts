import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import rateLimit from 'express-rate-limit';

import { registerUser, loginUser, refreshToken, logoutUser, changePassword, getUserById } from '../services/authService';
import { asyncHandler, createValidationError } from '../middleware/errorHandler';
import { authMiddleware, rateLimitByUser } from '../middleware/auth';
import { logger } from '../config/database';

const router = Router();

// Rate limiting for auth routes
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: {
    error: 'Too many authentication attempts',
    retryAfter: 15 * 60
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const registrationRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 registrations per hour per IP
  message: {
    error: 'Too many registration attempts',
    retryAfter: 60 * 60
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Validation middleware
const validateRegistration = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/)
    .withMessage('Password must contain uppercase, lowercase, number and special character'),
  body('firstName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be 2-50 characters'),
  body('lastName')
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
];

const validateLogin = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required'),
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
];

const validatePasswordChange = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('New password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/)
    .withMessage('New password must contain uppercase, lowercase, number and special character'),
];

// Helper function to check validation errors
const checkValidationErrors = (req: Request): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw createValidationError(errors.array());
  }
};

// Routes

// POST /api/auth/register - User registration
router.post('/register', 
  registrationRateLimit,
  validateRegistration,
  asyncHandler(async (req: Request, res: Response) => {
    checkValidationErrors(req);

    const {
      email,
      password,
      firstName,
      lastName,
      phone,
      dateOfBirth,
      nationality
    } = req.body;

    const result = await registerUser(
      email,
      password,
      firstName,
      lastName,
      phone,
      dateOfBirth,
      nationality
    );

    logger.info('User registration successful', {
      userId: result.user.id,
      email: result.user.email,
      ip: req.ip
    });

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: result
    });
  })
);

// POST /api/auth/login - User login
router.post('/login',
  authRateLimit,
  validateLogin,
  asyncHandler(async (req: Request, res: Response) => {
    checkValidationErrors(req);

    const { email, password } = req.body;
    
    // Collect device info
    const deviceInfo = {
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      timestamp: new Date().toISOString()
    };

    const result = await loginUser(email, password);

    logger.info('User login successful', {
      userId: result.user.id,
      email: result.user.email,
      role: result.user.role,
      ip: req.ip
    });

    res.json({
      success: true,
      message: 'Login successful',
      data: result
    });
  })
);

// POST /api/auth/refresh - Refresh access token
router.post('/refresh',
  authRateLimit,
  asyncHandler(async (req: Request, res: Response) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token is required'
      });
    }

    const tokens = await refreshToken(refreshToken);

    res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: { tokens }
    });
  })
);

// POST /api/auth/logout - User logout
router.post('/logout',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const { refreshToken } = req.body;
    const accessToken = req.headers.authorization?.substring(7); // Remove 'Bearer '

    await logoutUser(refreshToken);

    logger.info('User logout successful', {
      userId: req.user!.id,
      email: req.user!.email
    });

    res.json({
      success: true,
      message: 'Logout successful'
    });
  })
);

// GET /api/auth/me - Get current user profile
router.get('/me',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const userProfile = await getUserById(req.user!.id);

    res.json({
      success: true,
      data: { user: userProfile }
    });
  })
);

// POST /api/auth/change-password - Change user password
router.post('/change-password',
  authMiddleware,
  rateLimitByUser(3, 60), // 3 attempts per hour per user
  validatePasswordChange,
  asyncHandler(async (req: Request, res: Response) => {
    checkValidationErrors(req);

    const { currentPassword, newPassword } = req.body;

    await changePassword(req.user!.id, currentPassword, newPassword);

    logger.info('Password change successful', {
      userId: req.user!.id,
      email: req.user!.email
    });

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  })
);



export default router;