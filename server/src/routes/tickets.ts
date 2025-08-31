import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { query, logger } from '../config/database';
import { asyncHandler, createValidationError, createNotFoundError, AppError } from '../middleware/errorHandler';
import { authMiddleware, optionalAuth, requireRole } from '../middleware/auth';

const router = Router();

// Helper function to check validation errors
const checkValidationErrors = (req: Request): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw createValidationError(errors.array());
  }
};

// GET /api/tickets/:code/validate - Validate ticket code (public)
router.get('/:code/validate',
  asyncHandler(async (req: Request, res: Response) => {
    const { code } = req.params;

    if (!code || code.length < 5) {
      throw new AppError('Invalid ticket code format', 400);
    }

    // Get ticket details with exam info
    const ticketResult = await query(`
      SELECT 
        t.id, t.ticket_code, t.status, t.valid_from, t.valid_until,
        t.max_uses, t.current_uses, t.issued_to_email, t.issued_to_name,
        e.id as exam_id, e.title as exam_title, e.exam_type, e.duration_minutes
      FROM tickets t
      JOIN exams e ON t.exam_id = e.id
      WHERE t.ticket_code = $1
    `, [code.toUpperCase()]);

    if (ticketResult.rows.length === 0) {
      throw createNotFoundError('Ticket');
    }

    const ticket = ticketResult.rows[0];
    const now = new Date();

    // Check ticket validity
    const isValid = (
      ticket.status === 'active' &&
      new Date(ticket.valid_from) <= now &&
      new Date(ticket.valid_until) >= now &&
      ticket.current_uses < ticket.max_uses
    );

    const validationResult: any = {
      valid: isValid,
      ticket: {
        code: ticket.ticket_code,
        status: ticket.status,
        validFrom: ticket.valid_from,
        validUntil: ticket.valid_until,
        usesRemaining: ticket.max_uses - ticket.current_uses,
        maxUses: ticket.max_uses,
        issuedTo: {
          email: ticket.issued_to_email,
          name: ticket.issued_to_name
        }
      },
      exam: {
        id: ticket.exam_id,
        title: ticket.exam_title,
        type: ticket.exam_type,
        durationMinutes: ticket.duration_minutes
      },
      validationErrors: []
    };

    // Add specific validation errors
    if (ticket.status !== 'active') {
      validationResult.validationErrors.push(`Ticket status is ${ticket.status}`);
    }
    if (new Date(ticket.valid_from) > now) {
      validationResult.validationErrors.push('Ticket is not yet valid');
    }
    if (new Date(ticket.valid_until) < now) {
      validationResult.validationErrors.push('Ticket has expired');
    }
    if (ticket.current_uses >= ticket.max_uses) {
      validationResult.validationErrors.push('Ticket usage limit reached');
    }

    // Log validation attempt
    logger.info('Ticket validation', {
      ticketCode: code,
      isValid,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      data: validationResult
    });
  })
);

// POST /api/tickets/:code/use - Use ticket (authenticated)
router.post('/:code/use',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const { code } = req.params;
    const userId = req.user!.id;

    // Validate ticket first
    const ticketResult = await query(`
      SELECT 
        t.id, t.exam_id, t.status, t.valid_from, t.valid_until,
        t.max_uses, t.current_uses,
        e.title as exam_title, e.is_active as exam_active
      FROM tickets t
      JOIN exams e ON t.exam_id = e.id
      WHERE t.ticket_code = $1
    `, [code.toUpperCase()]);

    if (ticketResult.rows.length === 0) {
      throw createNotFoundError('Ticket');
    }

    const ticket = ticketResult.rows[0];
    const now = new Date();

    // Validate ticket
    if (ticket.status !== 'active') {
      throw new AppError(`Ticket is ${ticket.status}`, 400);
    }

    if (!ticket.exam_active) {
      throw new AppError('Associated exam is not active', 400);
    }

    if (new Date(ticket.valid_from) > now) {
      throw new AppError('Ticket is not yet valid', 400);
    }

    if (new Date(ticket.valid_until) < now) {
      throw new AppError('Ticket has expired', 400);
    }

    if (ticket.current_uses >= ticket.max_uses) {
      throw new AppError('Ticket usage limit reached', 400);
    }

    // Check if user already has an active session for this exam
    const existingSessionResult = await query(`
      SELECT id FROM exam_sessions 
      WHERE user_id = $1 AND exam_id = $2 AND status IN ('pending', 'in_progress')
      AND expires_at > CURRENT_TIMESTAMP
    `, [userId, ticket.exam_id]);

    if (existingSessionResult.rows.length > 0) {
      throw new AppError('You already have an active session for this exam', 400);
    }

    // Update ticket usage
    await query(`
      UPDATE tickets 
      SET current_uses = current_uses + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [ticket.id]);

    // Log ticket usage
    await query(`
      INSERT INTO ticket_usage (ticket_id, user_id, ip_address, user_agent)
      VALUES ($1, $2, $3, $4)
    `, [ticket.id, userId, req.ip, req.get('User-Agent')]);

    logger.info('Ticket used successfully', {
      userId,
      ticketId: ticket.id,
      ticketCode: code,
      examId: ticket.exam_id,
      ip: req.ip
    });

    res.json({
      success: true,
      message: 'Ticket validated and ready for exam',
      data: {
        ticketId: ticket.id,
        examId: ticket.exam_id,
        examTitle: ticket.exam_title,
        usesRemaining: ticket.max_uses - ticket.current_uses - 1
      }
    });
  })
);

// GET /api/tickets/:code/usage - Get ticket usage history (admin)
router.get('/:code/usage',
  authMiddleware,
  requireRole(['admin', 'super_admin']),
  asyncHandler(async (req: Request, res: Response) => {
    const { code } = req.params;

    // Get ticket usage history
    const usageResult = await query(`
      SELECT 
        tu.id, tu.used_at, tu.ip_address, tu.user_agent,
        u.email as user_email, u.first_name, u.last_name,
        t.ticket_code, t.issued_to_email, t.issued_to_name
      FROM ticket_usage tu
      JOIN tickets t ON tu.ticket_id = t.id
      LEFT JOIN users u ON tu.user_id = u.id
      WHERE t.ticket_code = $1
      ORDER BY tu.used_at DESC
    `, [code.toUpperCase()]);

    if (usageResult.rows.length === 0) {
      // Check if ticket exists
      const ticketCheck = await query(
        'SELECT id FROM tickets WHERE ticket_code = $1',
        [code.toUpperCase()]
      );
      
      if (ticketCheck.rows.length === 0) {
        throw createNotFoundError('Ticket');
      }
    }

    const usage = usageResult.rows.map((record: any) => ({
      id: record.id,
      usedAt: record.used_at,
      ipAddress: record.ip_address,
      userAgent: record.user_agent,
      user: record.user_email ? {
        email: record.user_email,
        firstName: record.first_name,
        lastName: record.last_name
      } : null,
      ticket: {
        code: record.ticket_code,
        issuedToEmail: record.issued_to_email,
        issuedToName: record.issued_to_name
      }
    }));

    res.json({
      success: true,
      data: { usage }
    });
  })
);

// GET /api/tickets/my - Get current user's tickets
router.get('/my',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const userEmail = req.user!.email;

    // Get tickets issued to user's email or used by user
    const ticketsResult = await query(`
      SELECT DISTINCT
        t.id, t.ticket_code, t.status, t.valid_from, t.valid_until,
        t.max_uses, t.current_uses, t.issued_to_email, t.issued_to_name,
        e.id as exam_id, e.title as exam_title, e.exam_type,
        CASE WHEN tu.user_id = $1 THEN true ELSE false END as used_by_me
      FROM tickets t
      JOIN exams e ON t.exam_id = e.id
      LEFT JOIN ticket_usage tu ON t.id = tu.ticket_id
      WHERE t.issued_to_email = $2 OR tu.user_id = $1
      ORDER BY t.created_at DESC
    `, [userId, userEmail]);

    const tickets = ticketsResult.rows.map((ticket: any) => ({
      id: ticket.id,
      code: ticket.ticket_code,
      status: ticket.status,
      validFrom: ticket.valid_from,
      validUntil: ticket.valid_until,
      usesRemaining: ticket.max_uses - ticket.current_uses,
      maxUses: ticket.max_uses,
      issuedTo: {
        email: ticket.issued_to_email,
        name: ticket.issued_to_name
      },
      exam: {
        id: ticket.exam_id,
        title: ticket.exam_title,
        type: ticket.exam_type
      },
      usedByMe: ticket.used_by_me
    }));

    res.json({
      success: true,
      data: { tickets }
    });
  })
);

// POST /api/tickets/bulk-validate - Validate multiple tickets (admin)
router.post('/bulk-validate',
  authMiddleware,
  requireRole(['admin', 'super_admin']),
  body('codes')
    .isArray({ min: 1, max: 50 })
    .withMessage('Codes must be an array of 1-50 ticket codes'),
  body('codes.*')
    .trim()
    .isLength({ min: 5, max: 20 })
    .withMessage('Each code must be 5-20 characters'),
  asyncHandler(async (req: Request, res: Response) => {
    checkValidationErrors(req);

    const { codes } = req.body;
    const upperCodes = codes.map((code: string) => code.toUpperCase());

    // Get all tickets
    const ticketsResult = await query(`
      SELECT 
        t.ticket_code, t.status, t.valid_from, t.valid_until,
        t.max_uses, t.current_uses,
        e.title as exam_title
      FROM tickets t
      JOIN exams e ON t.exam_id = e.id
      WHERE t.ticket_code = ANY($1)
    `, [upperCodes]);

    const ticketMap = new Map();
    ticketsResult.rows.forEach((ticket: any) => {
      ticketMap.set(ticket.ticket_code, ticket);
    });

    const results = upperCodes.map((code: any) => {
      const ticket = ticketMap.get(code);
      
      if (!ticket) {
        return {
          code,
          valid: false,
          error: 'Ticket not found'
        };
      }

      const now = new Date();
      const isValid = (
        ticket.status === 'active' &&
        new Date(ticket.valid_from) <= now &&
        new Date(ticket.valid_until) >= now &&
        ticket.current_uses < ticket.max_uses
      );

      return {
        code,
        valid: isValid,
        status: ticket.status,
        usesRemaining: ticket.max_uses - ticket.current_uses,
        examTitle: ticket.exam_title,
        error: !isValid ? 'Ticket is not valid' : null
      };
    });

    res.json({
      success: true,
      data: { results }
    });
  })
);

export default router;