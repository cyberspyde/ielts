import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/database-no-redis';

// Custom error class
export class AppError extends Error {
  public statusCode: number;
  public isOperational: boolean;

  constructor(message: string, statusCode: number = 500, isOperational: boolean = true) {
    super(message);
    
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

// Error response interface
interface ErrorResponse {
  error: string;
  message: string;
  statusCode: number;
  timestamp: string;
  path: string;
  stack?: string;
}

// Not found handler
export const notFoundHandler = (req: Request, res: Response, next: NextFunction): void => {
  const error = new AppError(`Route ${req.originalUrl} not found`, 404);
  next(error);
};

// Main error handler
export const errorHandler = (
  error: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  let statusCode = 500;
  let message = 'Internal server error';
  let isOperational = false;

  // Handle custom AppError
  if (error instanceof AppError) {
    statusCode = error.statusCode;
    message = error.message;
    isOperational = error.isOperational;
  }
  
  // Handle specific error types
  else if (error.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation failed';
  }
  else if (error.name === 'UnauthorizedError' || error.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Authentication failed';
  }
  else if (error.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
  }
  else if (error.name === 'CastError') {
    statusCode = 400;
    message = 'Invalid ID format';
  }
  else if (error.name === 'MongoError' && (error as any).code === 11000) {
    statusCode = 409;
    message = 'Duplicate field value';
  }

  // Log error
  const errorLog = {
    message: error.message,
    statusCode,
    stack: error.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: (req as any).user?.id,
  };

  if (statusCode >= 500) {
    logger.error('Server Error:', errorLog);
  } else {
    logger.warn('Client Error:', errorLog);
  }

  // Prepare error response
  const errorResponse: ErrorResponse = {
    error: statusCode >= 500 ? 'Internal Server Error' : error.name || 'Error',
    message,
    statusCode,
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
  };

  // Include stack trace in development
  if (process.env.NODE_ENV === 'development') {
    errorResponse.stack = error.stack;
  }

  // Standardized wrapper expected by client
  const { message: _msg, ...rest } = errorResponse; // avoid duplicate key confusion
  const payload = {
    success: false,
    message, // canonical message
    ...rest,
  };

  res.status(statusCode).json(payload);
};

// Async error wrapper
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Validation error helper
export const createValidationError = (errors: any[]): AppError => {
  const messages = errors.map(err => err.message || err.msg).join(', ');
  return new AppError(`Validation failed: ${messages}`, 400);
};

// Database error helper
export const createDatabaseError = (error: any): AppError => {
  if (error.code === '23505') { // Unique violation
    return new AppError('Resource already exists', 409);
  }
  if (error.code === '23503') { // Foreign key violation
    return new AppError('Referenced resource does not exist', 400);
  }
  if (error.code === '23502') { // Not null violation
    return new AppError('Required field is missing', 400);
  }
  
  logger.error('Database error:', error);
  return new AppError('Database operation failed', 500, false);
};

// Authentication error helpers
export const createAuthError = (message: string = 'Authentication required'): AppError => {
  return new AppError(message, 401);
};

export const createForbiddenError = (message: string = 'Access forbidden'): AppError => {
  return new AppError(message, 403);
};

// Not found error helper
export const createNotFoundError = (resource: string = 'Resource'): AppError => {
  return new AppError(`${resource} not found`, 404);
};