import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import { query, logger } from '../config/database';
import { asyncHandler, createValidationError, createNotFoundError, AppError } from '../middleware/errorHandler';
import { authMiddleware, requireRole, requireAdmin, requireSuperAdmin, rateLimitByUser } from '../middleware/auth';

const router = Router();

// All admin routes require authentication and admin role or higher
router.use(authMiddleware);
router.use(requireRole(['admin', 'super_admin']));

// Helper function to check validation errors
const checkValidationErrors = (req: Request): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw createValidationError(errors.array());
  }
};

// Helper function to log admin actions
const logAdminAction = async (userId: string, action: string, resourceType: string, resourceId?: string, details?: any): Promise<void> => {
  await query(`
    INSERT INTO admin_logs (user_id, action, resource_type, resource_id, details)
    VALUES ($1, $2, $3, $4, $5)
  `, [userId, action, resourceType, resourceId, JSON.stringify(details || {})]);
};

// GET /api/admin/dashboard - Admin dashboard stats
router.get('/dashboard',
  asyncHandler(async (req: Request, res: Response) => {
    // Get various statistics
    const [usersStats, examsStats, sessionsStats, ticketsStats] = await Promise.all([
      // Users statistics
      query(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
          COUNT(CASE WHEN role = 'student' THEN 1 END) as students,
          COUNT(CASE WHEN created_at > CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as new_this_month
        FROM users
      `),
      
      // Exams statistics
      query(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN is_active = true THEN 1 END) as active,
          COUNT(CASE WHEN created_at > CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as created_this_month
        FROM exams
      `),
      
      // Sessions statistics
      query(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN status = 'submitted' THEN 1 END) as completed,
          COUNT(CASE WHEN status IN ('pending', 'in_progress') THEN 1 END) as active,
          COUNT(CASE WHEN created_at > CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as this_week,
          AVG(CASE WHEN status = 'submitted' AND percentage_score IS NOT NULL THEN percentage_score END) as avg_score
        FROM exam_sessions
      `),
      
      // Tickets statistics
      query(`
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
          COUNT(CASE WHEN status = 'used' THEN 1 END) as used,
          COUNT(CASE WHEN valid_until < CURRENT_TIMESTAMP THEN 1 END) as expired
        FROM tickets
      `)
    ]);

    const stats = {
      users: usersStats.rows[0],
      exams: examsStats.rows[0],
      sessions: {
        ...sessionsStats.rows[0],
        avg_score: parseFloat(sessionsStats.rows[0].avg_score || 0).toFixed(2)
      },
      tickets: ticketsStats.rows[0]
    };

    // Recent activity
    const recentActivity = await query(`
      SELECT 
        al.action, al.resource_type, al.created_at, al.details,
        u.email as admin_email, u.first_name, u.last_name
      FROM admin_logs al
      JOIN users u ON al.user_id = u.id
      ORDER BY al.created_at DESC
      LIMIT 20
    `);

    const dashboard = {
      statistics: stats,
      recentActivity: recentActivity.rows.map((log: any) => ({
        action: log.action,
        resourceType: log.resource_type,
        createdAt: log.created_at,
        details: log.details,
        admin: {
          email: log.admin_email,
          name: `${log.first_name} ${log.last_name}`
        }
      }))
    };

    res.json({
      success: true,
      data: dashboard
    });
  })
);

// ==========================
// Exams Management (Admin)
// ==========================

// POST /api/admin/exams - Create a new exam
router.post('/exams',
  body('title').trim().isLength({ min: 3, max: 255 }).withMessage('Title is required'),
  body('description').optional().isString(),
  body('examType').isIn(['academic', 'general_training']).withMessage('Invalid exam type'),
  body('durationMinutes').isInt({ min: 1 }).withMessage('Duration is required'),
  body('passingScore').optional().isFloat({ min: 0, max: 9.0 }).withMessage('Passing score must be 0-9.0'),
  body('maxAttempts').optional().isInt({ min: 1, max: 10 }).withMessage('Max attempts must be 1-10'),
  body('instructions').optional().isString(),
  asyncHandler(async (req: Request, res: Response) => {
    checkValidationErrors(req);

    const { title, description, examType, durationMinutes, passingScore = 0, maxAttempts = 1, instructions } = req.body;

    const result = await query(`
      INSERT INTO exams (title, description, exam_type, duration_minutes, passing_score, max_attempts, instructions, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, created_at
    `, [title, description || null, examType, durationMinutes, passingScore, maxAttempts, instructions || null, req.user!.id]);

    const exam = result.rows[0];

    await logAdminAction(req.user!.id, 'CREATE_EXAM', 'exam', exam.id, { title, examType });

    res.status(201).json({
      success: true,
      message: 'Exam created successfully',
      data: { examId: exam.id }
    });
  })
);

// PUT /api/admin/exams/:examId - Update exam meta
router.put('/exams/:examId',
  body('title').optional().trim().isLength({ min: 3, max: 255 }),
  body('description').optional().isString(),
  body('examType').optional().isIn(['academic', 'general_training']),
  body('durationMinutes').optional().isInt({ min: 1 }),
  body('passingScore').optional().isFloat({ min: 0, max: 9.0 }),
  body('maxAttempts').optional().isInt({ min: 1, max: 10 }),
  body('instructions').optional().isString(),
  asyncHandler(async (req: Request, res: Response) => {
    checkValidationErrors(req);

    const { examId } = req.params;

    const fields: string[] = [];
    const values: any[] = [];
    let p = 1;
    const map: Record<string, string> = {
      title: 'title', description: 'description', examType: 'exam_type',
      durationMinutes: 'duration_minutes', passingScore: 'passing_score',
      maxAttempts: 'max_attempts', instructions: 'instructions'
    };
    for (const key of Object.keys(map)) {
      const val = (req.body as any)[key];
      if (val !== undefined) { fields.push(`${map[key]} = $${p++}`); values.push(val); }
    }
    if (fields.length === 0) {
      res.json({ success: true, message: 'No changes' });
      return;
    }
    values.push(examId);
    await query(`UPDATE exams SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${p}`, values);
    await logAdminAction(req.user!.id, 'UPDATE_EXAM', 'exam', examId, fields);
    res.json({ success: true, message: 'Exam updated' });
  })
);

// PUT /api/admin/exams/:examId/sections/:sectionId - Update a section
router.put('/exams/:examId/sections/:sectionId',
  body('title').optional().isString(),
  body('description').optional().isString(),
  body('durationMinutes').optional().isInt({ min: 1 }),
  body('maxScore').optional().isFloat({ min: 0, max: 9.0 }),
  body('sectionOrder').optional().isInt({ min: 1 }),
  body('instructions').optional().isString(),
  body('audioUrl').optional().isString(),
  body('passageText').optional().isString(),
  body('headingBank').optional(),
  asyncHandler(async (req: Request, res: Response) => {
    checkValidationErrors(req);
    const { examId, sectionId } = req.params;

    const fields: string[] = [];
    const values: any[] = [];
    let p = 1;
    const map: Record<string, string> = {
      title: 'title', description: 'description', durationMinutes: 'duration_minutes',
      maxScore: 'max_score', sectionOrder: 'section_order', instructions: 'instructions',
      audioUrl: 'audio_url', passageText: 'passage_text', headingBank: 'heading_bank'
    };
    for (const key of Object.keys(map)) {
      const val = (req.body as any)[key];
      if (val !== undefined) { fields.push(`${map[key]} = $${p++}`); values.push(key === 'headingBank' ? JSON.stringify(val) : val); }
    }
    if (fields.length === 0) { res.json({ success: true, message: 'No changes' }); return; }
    values.push(sectionId, examId);
    await query(`UPDATE exam_sections SET ${fields.join(', ')} WHERE id = $${p++} AND exam_id = $${p}`, values);
    await logAdminAction(req.user!.id, 'UPDATE_SECTION', 'exam', examId, { sectionId, fields });
    res.json({ success: true, message: 'Section updated' });
  })
);

// PUT /api/admin/questions/:questionId - Update a question
router.put('/questions/:questionId',
  body('questionType').optional().isIn(['multiple_choice','true_false','fill_blank','matching','essay','speaking_task','drag_drop']),
  body('questionText').optional().isString(),
  body('correctAnswer').optional().isString(),
  body('points').optional().isFloat({ min: 0 }),
  body('timeLimitSeconds').optional().isInt({ min: 0 }),
  body('explanation').optional().isString(),
  body('audioUrl').optional().isString(),
  body('imageUrl').optional().isString(),
  asyncHandler(async (req: Request, res: Response) => {
    checkValidationErrors(req);
    const { questionId } = req.params;
    const fields: string[] = [];
    const values: any[] = [];
    let p = 1;
    const map: Record<string, string> = {
      questionType: 'question_type', questionText: 'question_text', points: 'points',
      timeLimitSeconds: 'time_limit_seconds', explanation: 'explanation', correctAnswer: 'correct_answer',
      audioUrl: 'audio_url', imageUrl: 'image_url'
    };
    for (const key of Object.keys(map)) {
      const val = (req.body as any)[key];
      if (val !== undefined) { fields.push(`${map[key]} = $${p++}`); values.push(val); }
    }
    if (fields.length === 0) { res.json({ success: true, message: 'No changes' }); return; }
    values.push(questionId);
    await query(`UPDATE exam_questions SET ${fields.join(', ')}, created_at = created_at WHERE id = $${p}`, values);
    await logAdminAction(req.user!.id, 'UPDATE_QUESTION', 'question', questionId, fields);
    res.json({ success: true, message: 'Question updated' });
  })
);

// OPTIONS: Create/Update/Delete
router.post('/questions/:questionId/options',
  body('optionText').isString(),
  body('optionLetter').optional().isString(),
  body('optionOrder').optional().isInt({ min: 1 }),
  asyncHandler(async (req: Request, res: Response) => {
    checkValidationErrors(req);
    const { questionId } = req.params;
    const { optionText, optionLetter, optionOrder } = req.body;
    const r = await query(`
      INSERT INTO exam_question_options (question_id, option_text, option_letter, option_order)
      VALUES ($1, $2, $3, $4) RETURNING id
    `, [questionId, optionText, optionLetter || null, optionOrder || 1]);
    res.status(201).json({ success: true, data: { id: r.rows[0].id } });
  })
);

router.put('/options/:optionId',
  body('optionText').optional().isString(),
  body('optionLetter').optional().isString(),
  body('optionOrder').optional().isInt({ min: 1 }),
  asyncHandler(async (req: Request, res: Response) => {
    checkValidationErrors(req);
    const { optionId } = req.params;
    const fields: string[] = [];
    const values: any[] = [];
    let p = 1;
    const map: Record<string, string> = { optionText: 'option_text', optionLetter: 'option_letter', optionOrder: 'option_order' };
    for (const key of Object.keys(map)) {
      const val = (req.body as any)[key];
      if (val !== undefined) { fields.push(`${map[key]} = $${p++}`); values.push(val); }
    }
    if (fields.length === 0) { res.json({ success: true, message: 'No changes' }); return; }
    values.push(optionId);
    await query(`UPDATE exam_question_options SET ${fields.join(', ')} WHERE id = $${p}`, values);
    res.json({ success: true, message: 'Option updated' });
  })
);

router.delete('/options/:optionId',
  asyncHandler(async (req: Request, res: Response) => {
    const { optionId } = req.params;
    await query('DELETE FROM exam_question_options WHERE id = $1', [optionId]);
    res.json({ success: true, message: 'Option deleted' });
  })
);

// POST /api/admin/exams/:examId/sections - Create exam sections in bulk
router.post('/exams/:examId/sections',
  body('sections').isArray({ min: 1 }).withMessage('Sections array is required'),
  body('sections.*.sectionType').isIn(['listening', 'reading', 'writing', 'speaking']).withMessage('Invalid section type'),
  body('sections.*.title').trim().isLength({ min: 2 }).withMessage('Section title is required'),
  body('sections.*.durationMinutes').isInt({ min: 1 }).withMessage('Section duration required'),
  body('sections.*.maxScore').isFloat({ min: 0, max: 9.0 }).withMessage('Max score must be 0-9.0'),
  body('sections.*.sectionOrder').isInt({ min: 1 }).withMessage('Section order required'),
  body('sections.*.audioUrl').optional().isString(),
  body('sections.*.passageText').optional().isString(),
  body('sections.*.headingBank').optional(),
  asyncHandler(async (req: Request, res: Response) => {
    checkValidationErrors(req);

    const { examId } = req.params;
    const { sections } = req.body as { sections: Array<any> };

    // Verify exam exists
    const examCheck = await query('SELECT id FROM exams WHERE id = $1', [examId]);
    if (examCheck.rows.length === 0) {
      throw createNotFoundError('Exam');
    }

    const created: any[] = [];
    for (const s of sections) {
      const r = await query(`
        INSERT INTO exam_sections (
          exam_id, section_type, title, description, duration_minutes, max_score, section_order, instructions, audio_url, passage_text, heading_bank
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id
      `, [examId, s.sectionType, s.title, s.description || null, s.durationMinutes, s.maxScore, s.sectionOrder, s.instructions || null, s.audioUrl || null, s.passageText || null, s.headingBank ? JSON.stringify(s.headingBank) : null]);
      created.push({ id: r.rows[0].id, sectionType: s.sectionType, title: s.title });
    }

    await logAdminAction(req.user!.id, 'CREATE_SECTIONS', 'exam', examId, { count: sections.length });

    res.status(201).json({ success: true, message: 'Sections created', data: { sections: created } });
  })
);

// POST /api/admin/exams/:examId/questions/bulk - Create bulk questions by ranges
router.post('/exams/:examId/questions/bulk',
  body('sectionId').isUUID().withMessage('Valid sectionId is required'),
  body('groups').isArray({ min: 1 }).withMessage('Groups array is required'),
  body('groups.*.questionType').isIn(['multiple_choice', 'true_false', 'fill_blank', 'matching', 'short_answer', 'essay', 'speaking', 'speaking_task', 'drag_drop']).withMessage('Invalid question type'),
  body('groups.*.start').isInt({ min: 1 }).withMessage('Start question number required'),
  body('groups.*.end').isInt({ min: 1 }).withMessage('End question number required'),
  body('groups.*.points').optional().isFloat({ min: 0 }).withMessage('Points must be >= 0'),
  body('groups.*.options').optional().isArray().withMessage('Options must be an array when provided'),
  body('groups.*.correctAnswers').optional().isArray().withMessage('correctAnswers must be an array when provided'),
  asyncHandler(async (req: Request, res: Response) => {
    checkValidationErrors(req);

    const { examId } = req.params;
    const { sectionId, groups } = req.body as { sectionId: string; groups: Array<any> };

    // Validate section belongs to exam
    const sectionCheck = await query('SELECT id FROM exam_sections WHERE id = $1 AND exam_id = $2', [sectionId, examId]);
    if (sectionCheck.rows.length === 0) {
      throw new AppError('Section not found for this exam', 404);
    }

    let createdCount = 0;
    for (const g of groups) {
      const startNum = Number(g.start);
      const endNum = Number(g.end);
      if (endNum < startNum) {
        throw new AppError('Group end must be >= start', 400);
      }
      // Map client-friendly types to DB enum values
      const typeMap: Record<string, string> = {
        short_answer: 'essay',
        speaking: 'speaking_task',
      };
      const dbQuestionType = (typeMap[g.questionType] || g.questionType) as string;
      for (let num = startNum; num <= endNum; num++) {
        const rQ = await query(`
          INSERT INTO exam_questions (
            section_id, question_type, question_text, question_number, points
          ) VALUES ($1, $2, $3, $4, $5) RETURNING id
        `, [sectionId, dbQuestionType, g.questionText || '', num, g.points || 1.0]);
        const questionId = rQ.rows[0].id;

        // If provided, set correct answer per question by index within group
        if (Array.isArray(g.correctAnswers)) {
          const idx = num - startNum; // zero-based within group
          if (g.correctAnswers[idx] !== undefined) {
            await query(`UPDATE exam_questions SET correct_answer = $1 WHERE id = $2`, [String(g.correctAnswers[idx]), questionId]);
          }
        }

        // Create options if supplied or auto-create for matching
        let options: any[] | null = null;
        if (Array.isArray(g.options) && g.options.length > 0) {
          options = g.options;
        } else if (dbQuestionType === 'matching') {
          options = ['A','B','C','D','E','F','G'];
        }

        if (options) {
          let order = 1;
          for (const opt of options) {
            const isObj = typeof opt === 'object' && opt !== null;
            const letter = isObj ? (opt.letter || null) : (typeof opt === 'string' ? opt : null);
            const text = isObj ? (opt.text || '') : (typeof opt === 'string' ? opt : '');
            await query(`
              INSERT INTO exam_question_options (question_id, option_text, option_letter, option_order)
              VALUES ($1, $2, $3, $4)
            `, [questionId, text || letter || '', letter, order++]);
          }
        }
        createdCount++;
      }
    }

    await logAdminAction(req.user!.id, 'CREATE_QUESTIONS_BULK', 'exam', examId, { sectionId, groupsCount: groups.length, createdCount });

    res.status(201).json({ success: true, message: 'Questions created', data: { created: createdCount } });
  })
);

// GET /api/admin/users - List all users with pagination
router.get('/users',
  asyncHandler(async (req: Request, res: Response) => {
    const { 
      page = 1, 
      limit = 20, 
      search, 
      role, 
      status,
      sortBy = 'created_at',
      sortOrder = 'DESC'
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);
    const validSortBy = ['created_at', 'email', 'first_name', 'last_name', 'last_login'];
    const validSortOrder = ['ASC', 'DESC'];

    if (!validSortBy.includes(sortBy as string)) {
      throw new AppError('Invalid sort field', 400);
    }

    if (!validSortOrder.includes((sortOrder as string).toUpperCase())) {
      throw new AppError('Invalid sort order', 400);
    }

    let whereClause = 'WHERE 1=1';
    const queryParams = [];
    let paramCount = 1;

    // Search filter
    if (search) {
      whereClause += ` AND (email ILIKE $${paramCount} OR first_name ILIKE $${paramCount} OR last_name ILIKE $${paramCount})`;
      queryParams.push(`%${search}%`);
      paramCount++;
    }

    // Role filter
    if (role && ['student', 'admin', 'super_admin'].includes(role as string)) {
      whereClause += ` AND role = $${paramCount++}`;
      queryParams.push(role);
    }

    // Status filter
    if (status && ['active', 'inactive', 'suspended', 'pending'].includes(status as string)) {
      whereClause += ` AND status = $${paramCount++}`;
      queryParams.push(status);
    }

    // Get users
    const usersQuery = `
      SELECT id, email, first_name, last_name, phone, role, status, 
             email_verified, created_at, last_login
      FROM users 
      ${whereClause}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT $${paramCount++} OFFSET $${paramCount++}
    `;

    queryParams.push(limit, offset);

    const usersResult = await query(usersQuery, queryParams);

    // Get total count
    const countQuery = `SELECT COUNT(*) FROM users ${whereClause}`;
    const countResult = await query(countQuery, queryParams.slice(0, -2));

    const users = usersResult.rows.map((user: any) => ({
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      phone: user.phone,
      role: user.role,
      status: user.status,
      emailVerified: user.email_verified,
      createdAt: user.created_at,
      lastLogin: user.last_login
    }));

    const totalCount = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalCount / Number(limit));

    res.json({
      success: true,
      data: {
        users,
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

// POST /api/admin/tickets - Create exam tickets
router.post('/tickets',
  rateLimitByUser(20, 60), // 20 tickets per hour
  body('examId')
    .isUUID()
    .withMessage('Valid exam ID is required'),
  body('quantity')
    .isInt({ min: 1, max: 100 })
    .withMessage('Quantity must be between 1 and 100'),
  body('validFrom')
    .optional()
    .isISO8601()
    .withMessage('Invalid date format for validFrom'),
  body('validUntil')
    .isISO8601()
    .withMessage('Valid until date is required'),
  body('maxUses')
    .optional()
    .isInt({ min: 1, max: 10 })
    .withMessage('Max uses must be between 1 and 10'),
  body('issuedToEmail')
    .optional()
    .isEmail()
    .withMessage('Invalid email format'),
  body('issuedToName')
    .optional()
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Name must be 1-200 characters'),
  body('notes')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Notes too long'),
  asyncHandler(async (req: Request, res: Response) => {
    checkValidationErrors(req);

    const {
      examId,
      quantity,
      validFrom,
      validUntil,
      maxUses = 1,
      issuedToEmail,
      issuedToName,
      notes
    } = req.body;

    // Verify exam exists
    const examResult = await query('SELECT id, title FROM exams WHERE id = $1', [examId]);
    if (examResult.rows.length === 0) {
      throw createNotFoundError('Exam');
    }

    const exam = examResult.rows[0];

    // Validate dates
    const validFromDate = validFrom ? new Date(validFrom) : new Date();
    const validUntilDate = new Date(validUntil);

    if (validUntilDate <= validFromDate) {
      throw new AppError('Valid until date must be after valid from date', 400);
    }

    if (validUntilDate <= new Date()) {
      throw new AppError('Valid until date must be in the future', 400);
    }

    // Generate tickets
    const tickets = [];
    const ticketPrefix = process.env.TICKET_PREFIX || 'IELTS';

    for (let i = 0; i < quantity; i++) {
      const ticketCode = `${ticketPrefix}-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
      
      const ticketResult = await query(`
        INSERT INTO tickets (
          ticket_code, exam_id, issued_to_email, issued_to_name,
          status, valid_from, valid_until, max_uses, notes, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id, ticket_code, created_at
      `, [
        ticketCode,
        examId,
        issuedToEmail,
        issuedToName,
        'active',
        validFromDate,
        validUntilDate,
        maxUses,
        notes,
        req.user!.id
      ]);

      tickets.push({
        id: ticketResult.rows[0].id,
        code: ticketResult.rows[0].ticket_code,
        createdAt: ticketResult.rows[0].created_at
      });
    }

    // Log admin action
    await logAdminAction(
      req.user!.id,
      'CREATE_TICKETS',
      'ticket',
      examId,
      {
        examTitle: exam.title,
        quantity,
        validFrom: validFromDate,
        validUntil: validUntilDate,
        issuedToEmail,
        issuedToName
      }
    );

    logger.info('Tickets created', {
      adminId: req.user!.id,
      examId,
      quantity,
      ticketCodes: tickets.map(t => t.code)
    });

    res.status(201).json({
      success: true,
      message: `${quantity} ticket(s) created successfully`,
      data: {
        tickets,
        exam: {
          id: exam.id,
          title: exam.title
        }
      }
    });
  })
);

// GET /api/admin/tickets - List all tickets
router.get('/tickets',
  asyncHandler(async (req: Request, res: Response) => {
    const { 
      page = 1, 
      limit = 20, 
      examId, 
      status,
      search
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);

    let whereClause = 'WHERE 1=1';
    const queryParams = [];
    let paramCount = 1;

    // Filter by exam
    if (examId) {
      whereClause += ` AND t.exam_id = $${paramCount++}`;
      queryParams.push(examId);
    }

    // Filter by status
    if (status && ['active', 'used', 'expired', 'cancelled'].includes(status as string)) {
      whereClause += ` AND t.status = $${paramCount++}`;
      queryParams.push(status);
    }

    // Search filter
    if (search) {
      whereClause += ` AND (t.ticket_code ILIKE $${paramCount} OR t.issued_to_email ILIKE $${paramCount} OR t.issued_to_name ILIKE $${paramCount})`;
      queryParams.push(`%${search}%`);
      paramCount++;
    }

    // Get tickets with exam info
    const ticketsQuery = `
      SELECT 
        t.id, t.ticket_code, t.status, t.valid_from, t.valid_until,
        t.max_uses, t.current_uses, t.issued_to_email, t.issued_to_name,
        t.created_at,
        e.title as exam_title, e.exam_type,
        u.email as created_by_email
      FROM tickets t
      JOIN exams e ON t.exam_id = e.id
      JOIN users u ON t.created_by = u.id
      ${whereClause}
      ORDER BY t.created_at DESC
      LIMIT $${paramCount++} OFFSET $${paramCount++}
    `;

    queryParams.push(limit, offset);

    const ticketsResult = await query(ticketsQuery, queryParams);

    // Get total count
    const countQuery = `
      SELECT COUNT(*) 
      FROM tickets t 
      JOIN exams e ON t.exam_id = e.id 
      ${whereClause}
    `;
    const countResult = await query(countQuery, queryParams.slice(0, -2));

    const tickets = ticketsResult.rows.map((ticket: any) => ({
      id: ticket.id,
      code: ticket.ticket_code,
      status: ticket.status,
      validFrom: ticket.valid_from,
      validUntil: ticket.valid_until,
      maxUses: ticket.max_uses,
      currentUses: ticket.current_uses,
      usesRemaining: ticket.max_uses - ticket.current_uses,
      issuedTo: {
        email: ticket.issued_to_email,
        name: ticket.issued_to_name
      },
      exam: {
        title: ticket.exam_title,
        type: ticket.exam_type
      },
      createdBy: ticket.created_by_email,
      createdAt: ticket.created_at
    }));

    const totalCount = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalCount / Number(limit));

    res.json({
      success: true,
      data: {
        tickets,
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

// PUT /api/admin/tickets/:id/status - Update ticket status
router.put('/tickets/:id/status',
  body('status')
    .isIn(['active', 'cancelled'])
    .withMessage('Status must be active or cancelled'),
  body('reason')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Reason too long'),
  asyncHandler(async (req: Request, res: Response) => {
    checkValidationErrors(req);

    const { id } = req.params;
    const { status, reason } = req.body;

    // Check if ticket exists
    const ticketResult = await query(
      'SELECT id, ticket_code, status, exam_id FROM tickets WHERE id = $1',
      [id]
    );

    if (ticketResult.rows.length === 0) {
      throw createNotFoundError('Ticket');
    }

    const ticket = ticketResult.rows[0];

    // Update ticket status
    await query(
      'UPDATE tickets SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [status, id]
    );

    // Log admin action
    await logAdminAction(
      req.user!.id,
      'UPDATE_TICKET_STATUS',
      'ticket',
      id,
      {
        ticketCode: ticket.ticket_code,
        oldStatus: ticket.status,
        newStatus: status,
        reason
      }
    );

    logger.info('Ticket status updated', {
      adminId: req.user!.id,
      ticketId: id,
      ticketCode: ticket.ticket_code,
      oldStatus: ticket.status,
      newStatus: status,
      reason
    });

    res.json({
      success: true,
      message: `Ticket status updated to ${status}`,
      data: { status }
    });
  })
);

// GET /api/admin/sessions - List exam sessions
router.get('/sessions',
  asyncHandler(async (req: Request, res: Response) => {
    const { 
      page = 1, 
      limit = 20, 
      examId, 
      status,
      userId
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);

    let whereClause = 'WHERE 1=1';
    const queryParams = [];
    let paramCount = 1;

    if (examId) {
      whereClause += ` AND es.exam_id = $${paramCount++}`;
      queryParams.push(examId);
    }

    if (status) {
      whereClause += ` AND es.status = $${paramCount++}`;
      queryParams.push(status);
    }

    if (userId) {
      whereClause += ` AND es.user_id = $${paramCount++}`;
      queryParams.push(userId);
    }

    const sessionsQuery = `
      SELECT 
        es.id, es.status, es.started_at, es.submitted_at, es.expires_at,
        es.total_score, es.percentage_score, es.is_passed, es.time_spent_seconds,
        es.created_at,
        u.email as user_email, u.first_name, u.last_name,
        e.title as exam_title, e.exam_type,
        t.ticket_code
      FROM exam_sessions es
      LEFT JOIN users u ON es.user_id = u.id
      JOIN exams e ON es.exam_id = e.id
      LEFT JOIN tickets t ON es.ticket_id = t.id
      ${whereClause}
      ORDER BY es.created_at DESC
      LIMIT $${paramCount++} OFFSET $${paramCount++}
    `;

    queryParams.push(limit, offset);

    const sessionsResult = await query(sessionsQuery, queryParams);

    // Get total count
    const countQuery = `
      SELECT COUNT(*) 
      FROM exam_sessions es
      LEFT JOIN users u ON es.user_id = u.id
      JOIN exams e ON es.exam_id = e.id
      ${whereClause}
    `;
    const countResult = await query(countQuery, queryParams.slice(0, -2));

    const sessions = sessionsResult.rows.map((session: any) => ({
      id: session.id,
      status: session.status,
      startedAt: session.started_at,
      submittedAt: session.submitted_at,
      expiresAt: session.expires_at,
      totalScore: session.total_score,
      percentageScore: session.percentage_score,
      isPassed: session.is_passed,
      timeSpentSeconds: session.time_spent_seconds,
      createdAt: session.created_at,
      user: session.user_email ? {
        email: session.user_email,
        name: `${session.first_name} ${session.last_name}`
      } : null,
      exam: {
        title: session.exam_title,
        type: session.exam_type
      },
      ticketCode: session.ticket_code
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

// GET /api/admin/analytics - Get analytics data
router.get('/analytics',
  asyncHandler(async (req: Request, res: Response) => {
    const { 
      period = '30d',
      examId 
    } = req.query;

    // Determine date range based on period
    let dateCondition = "created_at >= CURRENT_DATE - INTERVAL '30 days'";
    if (period === '7d') {
      dateCondition = "created_at >= CURRENT_DATE - INTERVAL '7 days'";
    } else if (period === '90d') {
      dateCondition = "created_at >= CURRENT_DATE - INTERVAL '90 days'";
    } else if (period === '1y') {
      dateCondition = "created_at >= CURRENT_DATE - INTERVAL '1 year'";
    }

    let examCondition = '';
    const queryParams = [];
    if (examId) {
      examCondition = 'AND exam_id = $1';
      queryParams.push(examId);
    }

    // Get various analytics
    const [
      sessionsByDay,
      scoreDistribution,
      passRates,
      averageScores
    ] = await Promise.all([
      // Sessions by day
      query(`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as sessions,
          COUNT(CASE WHEN status = 'submitted' THEN 1 END) as completed
        FROM exam_sessions 
        WHERE ${dateCondition} ${examCondition}
        GROUP BY DATE(created_at)
        ORDER BY date
      `, queryParams),

      // Score distribution
      query(`
        SELECT 
          CASE 
            WHEN percentage_score >= 80 THEN '80-100'
            WHEN percentage_score >= 60 THEN '60-79'
            WHEN percentage_score >= 40 THEN '40-59'
            WHEN percentage_score >= 20 THEN '20-39'
            ELSE '0-19'
          END as score_range,
          COUNT(*) as count
        FROM exam_sessions 
        WHERE status = 'submitted' AND percentage_score IS NOT NULL
        AND ${dateCondition} ${examCondition}
        GROUP BY score_range
        ORDER BY score_range
      `, queryParams),

      // Pass rates by exam
      query(`
        SELECT 
          e.title as exam_title,
          COUNT(*) as total_attempts,
          COUNT(CASE WHEN es.is_passed = true THEN 1 END) as passed,
          ROUND(
            (COUNT(CASE WHEN es.is_passed = true THEN 1 END) * 100.0 / COUNT(*))::numeric, 
            2
          ) as pass_rate
        FROM exam_sessions es
        JOIN exams e ON es.exam_id = e.id
        WHERE es.status = 'submitted' AND ${dateCondition} ${examCondition}
        GROUP BY e.id, e.title
        ORDER BY pass_rate DESC
      `, queryParams),

      // Average scores over time
      query(`
        SELECT 
          DATE(created_at) as date,
          AVG(percentage_score) as avg_score,
          COUNT(*) as session_count
        FROM exam_sessions 
        WHERE status = 'submitted' AND percentage_score IS NOT NULL
        AND ${dateCondition} ${examCondition}
        GROUP BY DATE(created_at)
        ORDER BY date
      `, queryParams)
    ]);

    const analytics = {
      period,
      sessionsByDay: sessionsByDay.rows,
      scoreDistribution: scoreDistribution.rows,
      passRates: passRates.rows,
      averageScores: averageScores.rows.map((row: any) => ({
        ...row,
        avg_score: parseFloat(row.avg_score || 0).toFixed(2)
      }))
    };

    res.json({
      success: true,
      data: analytics
    });
  })
);

export default router;