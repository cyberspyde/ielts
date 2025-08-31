import { Pool, PoolConfig } from 'pg';
import dotenv from 'dotenv';
import winston from 'winston';

dotenv.config();

// Database configuration
const dbConfig: PoolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'ielts',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'your_postgres_password',
  min: parseInt(process.env.DB_POOL_MIN || '2'),
  max: parseInt(process.env.DB_POOL_MAX || '10'),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
};

// Create PostgreSQL connection pool
export const db = new Pool(dbConfig);

// Logger configuration
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'ielts-platform' },
  transports: [
    new winston.transports.File({ 
      filename: process.env.LOG_FILE || 'logs/error.log', 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: process.env.LOG_FILE || 'logs/combined.log' 
    }),
  ],
});

// Add console transport in development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    level: process.env.CONSOLE_LOG_LEVEL || process.env.LOG_LEVEL || 'error',
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

// Database connection helper
export const connectDatabase = async (): Promise<void> => {
  try {
    const client = await db.connect();
    await client.query('SELECT NOW()');
    client.release();
    logger.info('Database connected successfully');
  } catch (error) {
    logger.error('Database connection failed:', error);
    throw error;
  }
};

// Graceful shutdown
export const closeConnections = async (): Promise<void> => {
  try {
    await db.end();
    logger.info('Database connections closed');
  } catch (error) {
    logger.error('Error closing connections:', error);
  }
};

// Database query helper with logging
export const query = async (text: string, params?: any[]): Promise<any> => {
  const start = Date.now();
  try {
    const result = await db.query(text, params);
    const duration = Date.now() - start;
    logger.debug('Query executed', { text, duration, rows: result.rowCount });
    return result;
  } catch (error) {
    logger.error('Query failed', { text, params, error });
    throw error;
  }
};

// Simple in-memory session storage (alternative to Redis)
class MemorySessionStore {
  private sessions: Map<string, { data: any; expiresAt: number }> = new Map();

  setSession(sessionId: string, userId: string, data: any): void {
    const expiresAt = Date.now() + (86400 * 1000); // 24 hours default
    this.sessions.set(sessionId, { data: { userId, ...data }, expiresAt });
    
    // Clean up expired sessions
    this.cleanup();
  }

  getSession(sessionId: string): any | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return null;
    }
    
    return session.data;
  }

  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now > session.expiresAt) {
        this.sessions.delete(sessionId);
      }
    }
  }
}

// Create session store instance
export const sessionStore = new MemorySessionStore();

// Session management helpers (Redis-like interface)
export const sessionHelpers = {
  setSession: async (sessionId: string, userId: string, data: any): Promise<void> => {
    sessionStore.setSession(sessionId, userId, data);
  },

  getSession: async (sessionId: string): Promise<any | null> => {
    return sessionStore.getSession(sessionId);
  },

  deleteSession: async (sessionId: string): Promise<void> => {
    sessionStore.deleteSession(sessionId);
  },
};

// Rate limiting using in-memory storage
class MemoryRateLimiter {
  private limits: Map<string, { count: number; resetTime: number }> = new Map();

  incrementRateLimit(key: string, windowSeconds: number): number {
    const now = Date.now();
    const resetTime = now + (windowSeconds * 1000);
    
    const current = this.limits.get(key);
    if (!current || now > current.resetTime) {
      this.limits.set(key, { count: 1, resetTime });
      return 1;
    }
    
    current.count++;
    return current.count;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, limit] of this.limits.entries()) {
      if (now > limit.resetTime) {
        this.limits.delete(key);
      }
    }
  }
}

export const rateLimiter = new MemoryRateLimiter();

// Rate limiting helper
export const incrementRateLimit = async (key: string, windowSeconds: number): Promise<number> => {
  rateLimiter.cleanup();
  return rateLimiter.incrementRateLimit(key, windowSeconds);
};

// Health check function
export const healthCheck = async (): Promise<{ database: boolean }> => {
  const health = { database: false };

  try {
    await db.query('SELECT 1');
    health.database = true;
  } catch (error) {
    logger.warn('Database health check failed:', error);
  }

  return health;
};
