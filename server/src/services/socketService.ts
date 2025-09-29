import { Server, Socket } from 'socket.io';
import { query, logger } from '../config/database-no-redis';
import jwt from 'jsonwebtoken';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  userEmail?: string;
  userRole?: string;
}

interface ExamSession {
  id: string;
  userId: string;
  examId: string;
  status: string;
  currentSectionId?: string;
  expiresAt: Date;
}

// Store active exam sessions in memory
const activeSessions = new Map<string, ExamSession>();

// Authenticate socket connection
const authenticateSocket = async (socket: AuthenticatedSocket, token: string): Promise<boolean> => {
  try {
    if (!process.env.JWT_SECRET) {
      return false;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET) as any;
    
    if (!decoded.userId || !decoded.email) {
      return false;
    }

    // Get user from database to ensure they still exist and are active
    const userResult = await query(`
      SELECT id, email, role, status 
      FROM users 
      WHERE id = $1 AND status = 'active'
    `, [decoded.userId]);

    if (userResult.rows.length === 0) {
      return false;
    }

    const user = userResult.rows[0];
    socket.userId = user.id;
    socket.userEmail = user.email;
    socket.userRole = user.role;

    return true;
  } catch (error) {
    logger.error('Socket authentication failed:', error);
    return false;
  }
};

// Setup socket handlers
export const setupSocketHandlers = (io: Server): void => {
  io.on('connection', async (socket: AuthenticatedSocket) => {
    logger.info('Socket connected', { socketId: socket.id });

    // Authenticate connection
    socket.on('authenticate', async (data: { token: string }) => {
      const isAuthenticated = await authenticateSocket(socket, data.token);
      
      if (isAuthenticated) {
        socket.emit('authenticated', { success: true });
        logger.info('Socket authenticated', { 
          socketId: socket.id, 
          userId: socket.userId, 
          email: socket.userEmail 
        });
      } else {
        socket.emit('authentication_error', { message: 'Authentication failed' });
        socket.disconnect();
      }
    });

    // Join exam room
    socket.on('join_exam', async (data: { examId: string, sessionId: string }) => {
      if (!socket.userId) {
        socket.emit('error', { message: 'Authentication required' });
        return;
      }

      try {
        // Get user from database to ensure they still exist and are active
        const userResult = await query(`
          SELECT id, email, role, status 
          FROM users 
          WHERE id = $1 AND status = 'active'
        `, [socket.userId]);

        if (userResult.rows.length === 0) {
          socket.emit('error', { message: 'User not found or inactive' });
          return;
        }

        // Verify exam session exists and belongs to user
        const sessionResult = await query(`
          SELECT id, user_id, exam_id, status, current_section_id, expires_at
          FROM exam_sessions 
          WHERE id = $1 AND user_id = $2 AND status IN ('pending', 'in_progress')
        `, [data.sessionId, socket.userId]);

        if (sessionResult.rows.length === 0) {
          socket.emit('error', { message: 'Invalid exam session' });
          return;
        }

        const session = sessionResult.rows[0];

        // Check if session has expired
        if (new Date() > new Date(session.expires_at)) {
          socket.emit('error', { message: 'Exam session has expired' });
          return;
        }

        // Join exam room
        const roomName = `exam:${data.examId}:${data.sessionId}`;
        socket.join(roomName);

        // Store session info
        activeSessions.set(socket.id, {
          id: session.id,
          userId: session.user_id,
          examId: session.exam_id,
          status: session.status,
          currentSectionId: session.current_section_id,
          expiresAt: session.expires_at
        });

        socket.emit('joined_exam', { 
          sessionId: session.id,
          status: session.status,
          currentSectionId: session.current_section_id
        });

        logger.info('User joined exam room', {
          socketId: socket.id,
          userId: socket.userId,
          examId: data.examId,
          sessionId: data.sessionId
        });

      } catch (error) {
        logger.error('Error joining exam:', error);
        socket.emit('error', { message: 'Failed to join exam' });
      }
    });

    // Handle exam progress updates
    socket.on('exam_progress', async (data: { 
      sessionId: string, 
      currentSectionId: string, 
      answers: any[] 
    }) => {
      if (!socket.userId) {
        socket.emit('error', { message: 'Authentication required' });
        return;
      }

      try {
        // Update session progress in database
        await query(`
          UPDATE exam_sessions 
          SET current_section_id = $1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2 AND user_id = $3
        `, [data.currentSectionId, data.sessionId, socket.userId]);

        // Update local session
        const session = activeSessions.get(socket.id);
        if (session) {
          session.currentSectionId = data.currentSectionId;
        }

        // Broadcast to admin room (if admin is monitoring)
        socket.to(`admin:exam:${data.sessionId}`).emit('exam_progress_update', {
          sessionId: data.sessionId,
          currentSectionId: data.currentSectionId,
          timestamp: new Date().toISOString()
        });

        logger.debug('Exam progress updated', {
          sessionId: data.sessionId,
          currentSectionId: data.currentSectionId
        });

      } catch (error) {
        logger.error('Error updating exam progress:', error);
        socket.emit('error', { message: 'Failed to update progress' });
      }
    });

    // Handle exam submission
    socket.on('exam_submit', async (data: { sessionId: string }) => {
      if (!socket.userId) {
        socket.emit('error', { message: 'Authentication required' });
        return;
      }

      try {
        // Update session status
        await query(`
          UPDATE exam_sessions 
          SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND user_id = $2
        `, [data.sessionId, socket.userId]);

        // Remove from active sessions
        activeSessions.delete(socket.id);

        // Broadcast to admin room
        socket.to(`admin:exam:${data.sessionId}`).emit('exam_submitted', {
          sessionId: data.sessionId,
          timestamp: new Date().toISOString()
        });

        socket.emit('exam_submitted', { success: true });

        logger.info('Exam submitted', {
          sessionId: data.sessionId,
          userId: socket.userId
        });

      } catch (error) {
        logger.error('Error submitting exam:', error);
        socket.emit('error', { message: 'Failed to submit exam' });
      }
    });

    // Admin monitoring
    socket.on('admin_monitor_exam', async (data: { sessionId: string }) => {
      if (!socket.userId || !['admin', 'super_admin'].includes(socket.userRole || '')) {
        socket.emit('error', { message: 'Admin access required' });
        return;
      }

      try {
        // Verify session exists
        const sessionResult = await query(`
          SELECT id, user_id, exam_id, status
          FROM exam_sessions 
          WHERE id = $1
        `, [data.sessionId]);

        if (sessionResult.rows.length === 0) {
          socket.emit('error', { message: 'Exam session not found' });
          return;
        }

        // Join admin monitoring room
        const adminRoom = `admin:exam:${data.sessionId}`;
        socket.join(adminRoom);

        socket.emit('monitoring_started', { sessionId: data.sessionId });

        logger.info('Admin started monitoring exam', {
          adminId: socket.userId,
          sessionId: data.sessionId
        });

      } catch (error) {
        logger.error('Error starting exam monitoring:', error);
        socket.emit('error', { message: 'Failed to start monitoring' });
      }
    });

    // Force submit exam (admin only)
  socket.on('exam:force_submit', async (data: { sessionId: string, reason: string }) => {
      if (!socket.userId || !['admin', 'super_admin'].includes(socket.userRole || '')) {
        socket.emit('error', { message: 'Admin access required' });
        return;
      }

      try {
        // Update session status
        await query(`
          UPDATE exam_sessions 
          SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
        `, [data.sessionId]);

        // Log admin action
        await query(`
          INSERT INTO admin_logs (user_id, action, resource_type, resource_id, details)
          VALUES ($1, $2, $3, $4, $5)
        `, [
          socket.userId,
          'FORCE_SUBMIT_EXAM',
          'exam_session',
          data.sessionId,
          JSON.stringify({ reason: data.reason })
        ]);

        // Find the active session to get examId for proper room emit
        const active = Array.from(activeSessions.values()).find(s => s.id === data.sessionId);

        // Notify student in the specific exam room if known; otherwise broadcast to admin room listeners
        const targetRoom = active ? `exam:${active.examId}:${data.sessionId}` : undefined;
        const emitter = targetRoom ? socket.to(targetRoom) : socket;
        emitter.emit('exam:force_submit', {
          reason: data.reason,
          timestamp: new Date().toISOString()
        });

        logger.warn('Exam force submitted by admin', {
          adminId: socket.userId,
          sessionId: data.sessionId,
          reason: data.reason
        });

      } catch (error) {
        logger.error('Error force submitting exam:', error);
        socket.emit('error', { message: 'Failed to force submit exam' });
      }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      // Remove from active sessions
      activeSessions.delete(socket.id);

      logger.info('Socket disconnected', { 
        socketId: socket.id, 
        userId: socket.userId 
      });
    });

    // Handle errors
    socket.on('error', (error) => {
      logger.error('Socket error:', error);
    });
  });

  logger.info('Socket handlers setup complete');
};