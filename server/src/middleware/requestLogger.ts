import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../config/database';

// Extend Request interface to include correlationId
declare global {
  namespace Express {
    interface Request {
      correlationId: string;
      startTime: number;
    }
  }
}

// Request logging middleware
export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  // Generate correlation ID for request tracking
  req.correlationId = req.headers['x-correlation-id'] as string || uuidv4();
  req.startTime = Date.now();

  // Add correlation ID to response headers
  res.setHeader('X-Correlation-ID', req.correlationId);

  // Log request start
  const requestLog = {
    correlationId: req.correlationId,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    contentLength: req.get('Content-Length'),
    referer: req.get('Referer'),
    timestamp: new Date().toISOString(),
  };

  if ((process.env.CONSOLE_LOG_LEVEL || process.env.LOG_LEVEL || 'error') !== 'error') {
    logger.info('Request started', requestLog);
  }

  // Override res.json to log response
  const originalJson = res.json;
  res.json = function(body: any) {
    const responseTime = Date.now() - req.startTime;
    
    const responseLog = {
      correlationId: req.correlationId,
      statusCode: res.statusCode,
      responseTime: `${responseTime}ms`,
      contentLength: res.get('Content-Length'),
      timestamp: new Date().toISOString(),
    };

    // Log response based on status code
    if (res.statusCode >= 400) {
      logger.warn('Request completed with error', { ...requestLog, ...responseLog });
    } else {
      if ((process.env.CONSOLE_LOG_LEVEL || process.env.LOG_LEVEL || 'error') !== 'error') {
        logger.info('Request completed successfully', { ...requestLog, ...responseLog });
      }
    }

    return originalJson.call(this, body);
  };

  next();
};

// Performance monitoring middleware
export const performanceMonitor = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = process.hrtime.bigint();

  res.on('finish', () => {
    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds

    // Log slow requests (over 1 second)
    if (duration > 1000) {
      logger.warn('Slow request detected', {
        correlationId: req.correlationId,
        method: req.method,
        url: req.originalUrl,
        duration: `${duration.toFixed(2)}ms`,
        statusCode: res.statusCode,
      });
    }

    // Log performance metrics
    if ((process.env.CONSOLE_LOG_LEVEL || process.env.LOG_LEVEL || 'error') === 'debug') logger.debug('Request performance', {
      correlationId: req.correlationId,
      duration: `${duration.toFixed(2)}ms`,
      memoryUsage: process.memoryUsage(),
    });
  });

  next();
};

// Security logging middleware
export const securityLogger = (req: Request, res: Response, next: NextFunction): void => {
  const securityHeaders = {
    xForwardedFor: req.get('X-Forwarded-For'),
    xRealIp: req.get('X-Real-IP'),
    userAgent: req.get('User-Agent'),
    authorization: req.get('Authorization') ? 'Bearer ***' : undefined,
  };

  // Log security-relevant requests
  const securityRelevantPaths = ['/api/auth', '/api/admin', '/api/exams'];
  const isSecurityRelevant = securityRelevantPaths.some(path => req.path.startsWith(path));

  if (isSecurityRelevant) {
    logger.info('Security-relevant request', {
      correlationId: req.correlationId,
      method: req.method,
      path: req.path,
      ip: req.ip,
      ...securityHeaders,
    });
  }

  // Log suspicious activity
  const suspiciousPatterns = [
    /\.\.\//, // Path traversal
    /<script/i, // XSS attempts
    /union.*select/i, // SQL injection
    /eval\s*\(/i, // Code injection
  ];

  const isSuspicious = suspiciousPatterns.some(pattern => 
    pattern.test(req.url) || 
    pattern.test(JSON.stringify(req.body)) ||
    pattern.test(JSON.stringify(req.query))
  );

  if (isSuspicious) {
    logger.warn('Suspicious request detected', {
      correlationId: req.correlationId,
      method: req.method,
      url: req.url,
      body: req.body,
      query: req.query,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
    });
  }

  next();
};

// API usage tracking middleware
export const apiUsageTracker = (req: Request, res: Response, next: NextFunction): void => {
  res.on('finish', () => {
    // Track API endpoint usage
    const endpoint = `${req.method} ${req.route?.path || req.path}`;
    
    logger.info('API usage', {
      correlationId: req.correlationId,
      endpoint,
      statusCode: res.statusCode,
      responseTime: Date.now() - req.startTime,
      userId: (req as any).user?.id,
      userRole: (req as any).user?.role,
    });
  });

  next();
};