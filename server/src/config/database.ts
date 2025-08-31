import { Pool, PoolConfig } from 'pg';
import { createClient, RedisClientType } from 'redis';
import dotenv from 'dotenv';
import winston from 'winston';

dotenv.config();

// Database configuration
const dbConfig: PoolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'ielts_platform',
  user: process.env.DB_USER || 'ielts_user',
  password: process.env.DB_PASSWORD || 'ielts_password',
  min: parseInt(process.env.DB_POOL_MIN || '2'),
  max: parseInt(process.env.DB_POOL_MAX || '10'),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
};

// Create PostgreSQL connection pool
export const db = new Pool(dbConfig);

// Redis configuration
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB || '0'),
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  maxRetriesPerRequest: null,
};

// Create Redis client
export const redis: RedisClientType = createClient({
  socket: {
    host: redisConfig.host,
    port: redisConfig.port,
  },
  password: redisConfig.password,
  database: redisConfig.db,
});

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

// Redis connection helper
export const connectRedis = async (): Promise<void> => {
  try {
    await redis.connect();
    logger.info('Redis connected successfully');
  } catch (error) {
    logger.error('Redis connection failed:', error);
    throw error;
  }
};

// Graceful shutdown
export const closeConnections = async (): Promise<void> => {
  try {
    await db.end();
    await redis.quit();
    logger.info('Database and Redis connections closed');
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

// Redis helpers
export const redisHelpers = {
  // Set with expiration
  setex: async (key: string, seconds: number, value: string): Promise<void> => {
    await redis.setEx(key, seconds, value);
  },

  // Get value
  get: async (key: string): Promise<string | null> => {
    return await redis.get(key);
  },

  // Delete key
  del: async (key: string): Promise<void> => {
    await redis.del(key);
  },

  // Set JSON object
  setJson: async (key: string, seconds: number, value: any): Promise<void> => {
    await redis.setEx(key, seconds, JSON.stringify(value));
  },

  // Get JSON object
  getJson: async (key: string): Promise<any | null> => {
    const value = await redis.get(key);
    return value ? JSON.parse(value) : null;
  },

  // Session management
  setSession: async (sessionId: string, userId: string, data: any): Promise<void> => {
    const sessionKey = `session:${sessionId}`;
    await redis.setEx(sessionKey, 86400, JSON.stringify({ userId, ...data })); // 24 hours
  },

  getSession: async (sessionId: string): Promise<any | null> => {
    const sessionKey = `session:${sessionId}`;
    const session = await redis.get(sessionKey);
    return session ? JSON.parse(session) : null;
  },

  deleteSession: async (sessionId: string): Promise<void> => {
    const sessionKey = `session:${sessionId}`;
    await redis.del(sessionKey);
  },

  // Rate limiting
  incrementRateLimit: async (key: string, windowSeconds: number): Promise<number> => {
    const multi = redis.multi();
    multi.incr(key);
    multi.expire(key, windowSeconds);
    const results = await multi.exec();
    return results ? results[0] as number : 0;
  },
};

// Health check function
export const healthCheck = async (): Promise<{ database: boolean; redis: boolean }> => {
  const health = { database: false, redis: false };

  try {
    await db.query('SELECT 1');
    health.database = true;
  } catch (error) {
    logger.warn('Database health check failed:', error);
  }

  try {
    await redis.ping();
    health.redis = true;
  } catch (error) {
    logger.warn('Redis health check failed:', error);
  }

  return health;
};