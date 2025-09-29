import dotenv from 'dotenv';
dotenv.config();

import express from 'express';

import path from 'path';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { connectDatabase, logger, closeConnections } from './config/database-no-redis';
import { setupSocketHandlers } from './services/socketService';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import examRoutes from './routes/exams';
import ticketRoutes from './routes/tickets';
import adminRoutes from './routes/admin';
import healthRoutes from './routes/health';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';

export const app = express();
const server = createServer(app);
const io = new Server(server, {
  path: '/socket.io',
  cors: {
    // Allow typical dev origins; true also allowed but some proxies need explicit strings
    origin: [
      'http://localhost:5173', // Vite default
      'http://127.0.0.1:5173',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:7000',
      'http://127.0.0.1:7000'
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true
  }
});

// Open CORS for all origins and methods (development only)
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['*'],
  exposedHeaders: ['*']
}));
// Ensure preflight requests are handled
app.options('*', cors());

// Rate limiting disabled for local development
logger.info('Global rate limiter disabled for this environment');

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use(requestLogger);

// Health check route
app.use('/api/health', healthRoutes);

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/admin', adminRoutes);

// Static serving for uploaded media (audio files) with proper content type
const uploadsDir = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
app.use('/uploads', express.static(uploadsDir, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.mp3')) res.setHeader('Content-Type', 'audio/mpeg');
    else if (filePath.endsWith('.wav')) res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Accept-Ranges', 'bytes');
  }
}));

// Socket.io setup
setupSocketHandlers(io);

// Error handling middleware (must be last)
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found'
  });
});

const PORT = process.env.PORT || 7000;

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await closeConnections();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await closeConnections();
  process.exit(0);
});

// Start server
const startServer = async () => {
  try {
    await connectDatabase();
    
    server.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();