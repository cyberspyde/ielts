import { Request, Response, NextFunction } from 'express';
import { query, sessionHelpers, incrementRateLimit } from '../config/database-no-redis';
import jwt from 'jsonwebtoken';
import { AppError } from './errorHandler';

// Extend Express Request interface to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: string;
        status: string;
      };
    }
  }
}

// JWT token verification middleware
export const authMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('Access token required', 401);
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    if (!process.env.JWT_SECRET) {
      throw new AppError('JWT secret not configured', 500);
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET) as any;
    
    if (!decoded.userId || !decoded.email) {
      throw new AppError('Invalid token format', 401);
    }

    // Get user from database to ensure they still exist and are active
    const userResult = await query(`
      SELECT id, email, role, status 
      FROM users 
      WHERE id = $1 AND status = 'active'
    `, [decoded.userId]);

    if (userResult.rows.length === 0) {
      throw new AppError('User not found or inactive', 401);
    }

    const user = userResult.rows[0];
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status
    };

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(new AppError('Invalid token', 401));
    } else if (error instanceof jwt.TokenExpiredError) {
      next(new AppError('Token expired', 401));
    } else {
      next(error);
    }
  }
};

// Role-based access control middleware
export const requireRole = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new AppError('Authentication required', 401));
      return;
    }

    if (!roles.includes(req.user.role)) {
      next(new AppError('Insufficient permissions', 403));
      return;
    }

    next();
  };
};

// Admin-only middleware
export const requireAdmin = requireRole(['admin', 'super_admin']);

// Super admin only middleware
export const requireSuperAdmin = requireRole(['super_admin']);

// User management permission (admin can manage regular users, super admin can manage all)
export const requireUserManagementPermission = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    next(new AppError('Authentication required', 401));
    return;
  }

  if (!['admin', 'super_admin'].includes(req.user.role)) {
    next(new AppError('Insufficient permissions', 403));
    return;
  }

  next();
};

// Ownership or admin check middleware
export const requireOwnershipOrAdmin = (paramName: string) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new AppError('Authentication required', 401));
      return;
    }

    const resourceId = req.params[paramName];
    
    // Admin can access any resource
    if (['admin', 'super_admin'].includes(req.user.role)) {
      next();
      return;
    }

    // User can only access their own resources
    if (req.user.id === resourceId) {
      next();
      return;
    }

    next(new AppError('Access denied', 403));
  };
};

// Rate limiting by user ID
export const rateLimitByUser = (maxRequests: number, windowSeconds: number) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      next(new AppError('Authentication required', 401));
      return;
    }

    const key = `rate_limit:${req.user.id}:${req.path}`;
    const current = await incrementRateLimit(key, windowSeconds);
    if (current > maxRequests) {
      next(new AppError('Rate limit exceeded', 429));
      return;
    }
    
    next();
  };
};

// Session validation middleware
export const validateSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const sessionId = req.headers['x-session-id'] as string;
    
    if (!sessionId) {
      next(new AppError('Session ID required', 401));
      return;
    }

    const session = await sessionHelpers.getSession(sessionId);
    
    if (!session) {
      next(new AppError('Invalid session', 401));
      return;
    }

    // Get user from database
    const userResult = await query(`
      SELECT id, email, role, status 
      FROM users 
      WHERE id = $1 AND status = 'active'
    `, [session.userId]);

    if (userResult.rows.length === 0) {
      await sessionHelpers.deleteSession(sessionId);
      next(new AppError('User not found or inactive', 401));
      return;
    }

    const user = userResult.rows[0];
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status
    };

    next();
  } catch (error) {
    next(error);
  }
};

// Optional authentication middleware (doesn't fail if no token)
export const optionalAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      next();
      return;
    }

    const token = authHeader.substring(7);
    
    if (!process.env.JWT_SECRET) {
      next();
      return;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET) as any;
    
    if (!decoded.userId || !decoded.email) {
      next();
      return;
    }

    const userResult = await query(`
      SELECT id, email, role, status 
      FROM users 
      WHERE id = $1 AND status = 'active'
    `, [decoded.userId]);

    if (userResult.rows.length > 0) {
      const user = userResult.rows[0];
      req.user = {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status
      };
    }

    next();
  } catch (error) {
    // Don't fail on token errors, just continue without user
    next();
  }
};