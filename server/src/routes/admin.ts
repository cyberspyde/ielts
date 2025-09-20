import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { body, validationResult } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import { query, logger } from '../config/database-no-redis';
import { asyncHandler, createValidationError, createNotFoundError, AppError } from '../middleware/errorHandler';
import { authMiddleware, requireRole, requireAdmin, requireSuperAdmin, rateLimitByUser } from '../middleware/auth';

const router = Router();

// File upload (audio) setup
const uploadsRoot = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsRoot)) {
  fs.mkdirSync(uploadsRoot, { recursive: true });
}
const audioStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(uploadsRoot, 'audio');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g,'_');
    cb(null, `${Date.now()}_${base}${ext}`);
  }
});
const audioFilter: multer.Options['fileFilter'] = (req, file, cb) => {
  const allowed = ['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/wave'];
  if (allowed.includes(file.mimetype)) cb(null, true); else cb(new AppError('Invalid audio file type', 400));
};
const uploadAudio = multer({ storage: audioStorage, fileFilter: audioFilter, limits: { fileSize: 25 * 1024 * 1024 } }); // 25MB

// File upload (images) setup
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(uploadsRoot, 'images');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g,'_');
    cb(null, `${Date.now()}_${base}${ext}`);
  }
});
const imageFilter: multer.Options['fileFilter'] = (req, file, cb) => {
  const allowed = ['image/png','image/jpeg','image/jpg','image/webp','image/gif'];
  if (allowed.includes(file.mimetype)) cb(null, true); else cb(new AppError('Invalid image file type', 400));
};
const uploadImage = multer({ storage: imageStorage, fileFilter: imageFilter, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

// POST /api/admin/sections/:sectionId/audio - upload or replace listening section audio
// NOTE: Frontend sends the file under the key 'file' (apiService.upload). Accept that here.
// Secure audio upload (auth first to avoid processing file for unauthenticated users)
router.post('/sections/:sectionId/audio', authMiddleware, requireRole(['admin','super_admin']), uploadAudio.single('file'), asyncHandler(async (req: Request, res: Response) => {
  const { sectionId } = req.params;
  // Support both 'file' and legacy 'audio' field names just in case
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) throw new AppError('Audio file required', 400);
  // Verify listening section
  const sec = await query('SELECT id, exam_id, section_type, audio_url FROM exam_sections WHERE id = $1', [sectionId]);
  if (sec.rowCount === 0) throw createNotFoundError('Section');
  if (sec.rows[0].section_type !== 'listening') throw new AppError('Audio can only be uploaded for listening sections', 400);
  const publicPath = `/uploads/audio/${path.basename(file.path)}`;
  // exam_sections table lacks updated_at; just update audio_url
  await query('UPDATE exam_sections SET audio_url = $1 WHERE id = $2', [publicPath, sectionId]);
  const userId = (req.user && (req.user as any).id) || '00000000-0000-0000-0000-000000000000';
  const absoluteUrl = `${req.protocol}://${req.get('host')}${publicPath}`;
  await logAdminAction(userId, 'UPLOAD_SECTION_AUDIO', 'exam', sec.rows[0].exam_id, { sectionId, audio: publicPath, absoluteUrl });
  res.status(201).json({ success: true, message: 'Audio uploaded', data: { audioUrl: publicPath, absoluteUrl } });
}));

// POST /api/admin/exams/:examId/audio - upload or replace centralized exam listening audio
router.post('/exams/:examId/audio', authMiddleware, requireRole(['admin','super_admin']), uploadAudio.single('file'), asyncHandler(async (req: Request, res: Response) => {
  const { examId } = req.params;
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) throw new AppError('Audio file required', 400);
  // Ensure exam exists
  const ex = await query('SELECT id FROM exams WHERE id = $1', [examId]);
  if (ex.rowCount === 0) throw createNotFoundError('Exam');
  const publicPath = `/uploads/audio/${path.basename(file.path)}`;
  await query('UPDATE exams SET audio_url = $1 WHERE id = $2', [publicPath, examId]);
  const userId = (req.user && (req.user as any).id) || '00000000-0000-0000-0000-000000000000';
  const absoluteUrl = `${req.protocol}://${req.get('host')}${publicPath}`;
  await logAdminAction(userId, 'UPLOAD_EXAM_AUDIO', 'exam', examId, { audio: publicPath, absoluteUrl });
  res.status(201).json({ success: true, message: 'Exam audio uploaded', data: { audioUrl: publicPath, absoluteUrl } });
}));

// POST /api/admin/questions/:questionId/image - upload and attach image to a question (image_url)
router.post('/questions/:questionId/image', authMiddleware, requireRole(['admin','super_admin']), uploadImage.single('file'), asyncHandler(async (req: Request, res: Response) => {
  const { questionId } = req.params;
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) throw new AppError('Image file required', 400);
  // Ensure question exists and get exam id via join for logging
  const q = await query(`
    SELECT q.id, q.section_id, s.exam_id
    FROM exam_questions q
    JOIN exam_sections s ON q.section_id = s.id
    WHERE q.id = $1
  `, [questionId]);
  if (q.rowCount === 0) throw createNotFoundError('Question');
  const publicPath = `/uploads/images/${path.basename(file.path)}`;
  await query('UPDATE exam_questions SET image_url = $1 WHERE id = $2', [publicPath, questionId]);
  const userId = (req.user && (req.user as any).id) || '00000000-0000-0000-0000-000000000000';
  const absoluteUrl = `${req.protocol}://${req.get('host')}${publicPath}`;
  await logAdminAction(userId, 'UPLOAD_QUESTION_IMAGE', 'exam', q.rows[0].exam_id, { questionId, image: publicPath, absoluteUrl });
  res.status(201).json({ success: true, message: 'Image uploaded', data: { imageUrl: publicPath, absoluteUrl } });
}));

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

// PATCH /api/admin/sessions/:sessionId/answers/:questionId/grade - grade a single answer
router.patch('/sessions/:sessionId/answers/:questionId/grade',
  body('pointsEarned').isFloat({ min: 0 }).withMessage('pointsEarned required'),
  body('isCorrect').optional().isBoolean(),
  body('comments').optional().isString(),
  asyncHandler(async (req: Request, res: Response) => {
    const { sessionId, questionId } = req.params;
    const { pointsEarned, isCorrect, comments } = req.body as { pointsEarned: number; isCorrect?: boolean; comments?: string };
    const ans = await query('SELECT id FROM exam_session_answers WHERE session_id = $1 AND question_id = $2', [sessionId, questionId]);
    if (ans.rowCount === 0) throw createNotFoundError('Answer');
    await query(`UPDATE exam_session_answers SET points_earned = $1, graded_at = CURRENT_TIMESTAMP, graded_by = $2, grader_comments = COALESCE($3, grader_comments), is_correct = COALESCE($4, is_correct) WHERE session_id = $5 AND question_id = $6`, [pointsEarned, req.user!.id, comments || null, (typeof isCorrect === 'boolean' ? isCorrect : null), sessionId, questionId]);
    res.json({ success: true, message: 'Answer graded' });
  })
);

// POST /api/admin/sessions/:sessionId/recalculate - recompute totals after grading
router.post('/sessions/:sessionId/recalculate', asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  // Fetch passing score & exam id
  const passRow = await query(`
    SELECT e.id as exam_id, e.passing_score
    FROM exam_sessions es
    JOIN exams e ON e.id = es.exam_id
    WHERE es.id = $1
  `, [sessionId]);
  if (passRow.rowCount === 0) throw createNotFoundError('Session');
  const passingScore = parseFloat(passRow.rows[0].passing_score);

  // Fetch all answers with context
  const ansRows = await query(`
    SELECT esa.points_earned, eq.points AS max_points, eq.question_type, eq.metadata, esec.section_type
    FROM exam_session_answers esa
    JOIN exam_questions eq ON eq.id = esa.question_id
    JOIN exam_sections esec ON esec.id = eq.section_id
    WHERE esa.session_id = $1
  `, [sessionId]);

  let totalScore = 0;
  let percentageScore = 0;

  // Special handling: Writing band = (Task1 + 2*Task2)/3 rounded to nearest 0.5
  const writing = ansRows.rows.filter((r:any)=> r.section_type === 'writing');
  if (writing.length > 0) {
    let bandTask1 = 0;
    let bandTask2 = 0;
    for (const r of writing) {
      const qType = r.question_type;
      const pts = parseFloat(r.points_earned || 0);
      if (qType === 'writing_task1') bandTask1 = Math.max(bandTask1, pts);
      else if (qType === 'essay') bandTask2 = Math.max(bandTask2, pts);
    }
    const raw = (bandTask1 + 2 * bandTask2) / 3;
    const rounded = Math.round(raw * 2) / 2; // nearest 0.5
    totalScore = rounded;
    percentageScore = (rounded / 9) * 100;
  } else {
    // Default: sum of earned points vs max points
    let earned = 0; let max = 0;
    for (const r of ansRows.rows) {
      earned += parseFloat(r.points_earned || 0);
      max += parseFloat(r.max_points || 0);
    }
    totalScore = earned;
    percentageScore = max > 0 ? (earned / max) * 100 : 0;
  }

  const isPassed = percentageScore >= passingScore;
  await query(`UPDATE exam_sessions SET total_score = $1, percentage_score = $2, is_passed = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`, [totalScore, percentageScore, isPassed, sessionId]);
  res.json({ success: true, message: 'Recalculated', data: { totalScore, percentageScore, isPassed } });
}));

// POST /api/admin/sessions/:sessionId/approve - mark results as approved/publishable
router.post('/sessions/:sessionId/approve', asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  await query(`UPDATE exam_sessions SET is_approved = true, approved_at = CURRENT_TIMESTAMP, approved_by = $1 WHERE id = $2`, [req.user!.id, sessionId]);
  res.json({ success: true, message: 'Results approved' });
}));

// ==========================
// Exams Management (Admin)
// ==========================

// POST /api/admin/exams - Create a new exam
router.post('/exams',
  body('title').trim().isLength({ min: 3, max: 255 }).withMessage('Title is required'),
  body('description').optional().isString(),
  body('examType').isIn(['academic', 'general_training']).withMessage('Invalid exam type'),
  body('durationMinutes').isInt({ min: 1 }).withMessage('Duration is required'),
  body('audioUrl').optional().isString(),
  body('passingScore').optional().isFloat({ min: 0, max: 9.0 }).withMessage('Passing score must be 0-9.0'),
  body('maxAttempts').optional().isInt({ min: 1, max: 10 }).withMessage('Max attempts must be 1-10'),
  body('instructions').optional().isString(),
  asyncHandler(async (req: Request, res: Response) => {
    checkValidationErrors(req);

  const { title, description, examType, durationMinutes, passingScore = 0, maxAttempts = 1, instructions, audioUrl } = req.body;

    const result = await query(`
      INSERT INTO exams (title, description, exam_type, duration_minutes, passing_score, max_attempts, instructions, audio_url, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, created_at
    `, [title, description || null, examType, durationMinutes, passingScore, maxAttempts, instructions || null, audioUrl || null, req.user!.id]);

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
  body('audioUrl').optional().isString(),
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
      maxAttempts: 'max_attempts', instructions: 'instructions', audioUrl: 'audio_url'
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

// DELETE /api/admin/exams/:examId - Delete exam and dependent data
router.delete('/exams/:examId', asyncHandler(async (req: Request, res: Response) => {
  const { examId } = req.params;
  // Verify exists
  const exists = await query('SELECT id FROM exams WHERE id = $1', [examId]);
  if (exists.rowCount === 0) throw createNotFoundError('Exam');
  await query('BEGIN');
  try {
    // Delete answers -> sessions -> question options -> questions -> sections -> tickets -> exam
    await query('DELETE FROM exam_session_answers WHERE session_id IN (SELECT id FROM exam_sessions WHERE exam_id = $1)', [examId]);
    await query('DELETE FROM exam_sessions WHERE exam_id = $1', [examId]);
    await query('DELETE FROM exam_question_options WHERE question_id IN (SELECT id FROM exam_questions WHERE section_id IN (SELECT id FROM exam_sections WHERE exam_id = $1))', [examId]);
    await query('DELETE FROM exam_questions WHERE section_id IN (SELECT id FROM exam_sections WHERE exam_id = $1)', [examId]);
    await query('DELETE FROM exam_sections WHERE exam_id = $1', [examId]);
    await query('DELETE FROM tickets WHERE exam_id = $1', [examId]);
    await query('DELETE FROM exams WHERE id = $1', [examId]);
    await query('COMMIT');
  } catch (e) {
    await query('ROLLBACK');
    throw e;
  }
  await logAdminAction(req.user!.id, 'DELETE_EXAM', 'exam', examId, {});
  res.json({ success: true, message: 'Exam deleted' });
}));

// PUT /api/admin/exams/:examId/sections/:sectionId - Update a section
router.put('/exams/:examId/sections/:sectionId',
  body('title').optional().isString(),
  body('description').optional().isString(),
  // durationMinutes deprecated (global exam duration enforced) – ignore if provided
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
      title: 'title', description: 'description',
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

// DELETE /api/admin/sections/:sectionId - Delete a single section and its questions/options/answers
router.delete('/sections/:sectionId', asyncHandler(async (req: Request, res: Response) => {
  const { sectionId } = req.params;
  // Lookup section + exam for logging
  const sec = await query('SELECT id, exam_id FROM exam_sections WHERE id = $1', [sectionId]);
  if (sec.rowCount === 0) throw createNotFoundError('Section');
  await query('BEGIN');
  try {
    // Delete answers related to questions in this section
    await query('DELETE FROM exam_session_answers WHERE question_id IN (SELECT id FROM exam_questions WHERE section_id = $1)', [sectionId]);
    // Delete question options
    await query('DELETE FROM exam_question_options WHERE question_id IN (SELECT id FROM exam_questions WHERE section_id = $1)', [sectionId]);
    // Delete questions
    await query('DELETE FROM exam_questions WHERE section_id = $1', [sectionId]);
    // Finally delete section
    await query('DELETE FROM exam_sections WHERE id = $1', [sectionId]);
    await query('COMMIT');
  } catch (e) {
    await query('ROLLBACK');
    throw e;
  }
  await logAdminAction(req.user!.id, 'DELETE_SECTION', 'exam', sec.rows[0].exam_id, { sectionId });
  res.json({ success: true, message: 'Section deleted' });
}));

// PUT /api/admin/questions/:questionId - Update a question
router.put('/questions/:questionId',
  body('questionType').optional().isIn(['multiple_choice','true_false','fill_blank','matching','essay','speaking_task','drag_drop','short_answer','writing_task1','table_fill_blank','table_drag_drop','simple_table','image_labeling','image_dnd']),
  body('questionText').optional().isString(),
  body('correctAnswer').optional().isString(),
  body('points').optional().isFloat({ min: 0 }),
  body('timeLimitSeconds').optional().isInt({ min: 0 }),
  body('explanation').optional().isString(),
  body('audioUrl').optional().isString(),
  body('imageUrl').optional().isString(),
  body('metadata').optional(),
  asyncHandler(async (req: Request, res: Response) => {
    checkValidationErrors(req);
    const { questionId } = req.params;
    const fields: string[] = [];
    const values: any[] = [];
    let p = 1;
    const map: Record<string, string> = {
      questionType: 'question_type', questionText: 'question_text', points: 'points',
      timeLimitSeconds: 'time_limit_seconds', explanation: 'explanation', correctAnswer: 'correct_answer',
      audioUrl: 'audio_url', imageUrl: 'image_url', metadata: 'metadata'
    };
    for (const key of Object.keys(map)) {
      const val = (req.body as any)[key];
      if (val !== undefined) { fields.push(`${map[key]} = $${p++}`); values.push(key === 'metadata' ? JSON.stringify(val) : val); }
    }
    if (fields.length === 0) { res.json({ success: true, message: 'No changes' }); return; }
    values.push(questionId);
    await query(`UPDATE exam_questions SET ${fields.join(', ')}, created_at = created_at WHERE id = $${p}`, values);
    await logAdminAction(req.user!.id, 'UPDATE_QUESTION', 'question', questionId, fields);
    res.json({ success: true, message: 'Question updated' });
  })
);

// POST /api/admin/sections/:sectionId/questions - Create a single question
router.post('/sections/:sectionId/questions',
  body('questionType').isIn(['multiple_choice','true_false','fill_blank','matching','essay','speaking_task','drag_drop','short_answer','writing_task1','table_fill_blank','table_drag_drop','simple_table','image_labeling','image_dnd']).withMessage('Invalid question type'),
  body('questionText').optional().isString(),
  body('correctAnswer').optional().isString(),
  body('points').optional().isFloat({ min: 0 }),
  body('questionNumber').optional().isInt({ min: 1 }),
  body('metadata').optional(),
  asyncHandler(async (req: Request, res: Response) => {
    checkValidationErrors(req);
    const { sectionId } = req.params;
    const { questionType, questionText = '', correctAnswer, points = 1, questionNumber, metadata } = req.body;
    // Auto-normalize table_fill_blank and simple_table: ensure metadata structure
    let normMetadata = metadata;
    if (questionType === 'table_fill_blank' || questionType === 'table_drag_drop') {
      const baseTable = (metadata && (metadata as any).table) || (metadata && (metadata as any).tableBlock);
      const rows = baseTable?.rows || [[" "]];
      normMetadata = { ...(metadata||{}), table: { rows, sizes: baseTable?.sizes || [] } };
      if (questionType.startsWith('table_') && (req.body.points === undefined || req.body.points === null)) {
        (req.body as any).points = 0; // container not directly scored
      }
    } else if (questionType === 'simple_table') {
      const baseTable = (metadata && (metadata as any).simpleTable);
      const rows = baseTable?.rows || [[{ type: 'text', content: '' }]];
      normMetadata = { ...(metadata||{}), simpleTable: { rows } };
      if (req.body.points === undefined || req.body.points === null) {
        (req.body as any).points = 0; // container not directly scored
      }
    }
    // Verify section
    const sec = await query('SELECT id, exam_id FROM exam_sections WHERE id = $1', [sectionId]);
    if (sec.rowCount === 0) throw createNotFoundError('Section');
    let qNum = questionNumber;
    if (!qNum) {
      const r = await query('SELECT COALESCE(MAX(question_number),0)+1 AS next FROM exam_questions WHERE section_id = $1', [sectionId]);
      qNum = Number(r.rows[0].next) || 1;
    }
    let newId: string | null = null;
    // Retry a few times if duplicate question_number due to race conditions
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const rQ = await query(`
          INSERT INTO exam_questions (section_id, question_type, question_text, question_number, points, correct_answer, metadata)
          VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
        `, [sectionId, questionType, questionText, qNum, points, correctAnswer || null, normMetadata ? JSON.stringify(normMetadata) : null]);
        newId = rQ.rows[0].id; break;
      } catch (e: any) {
        if (e?.code === '23505' && /uq_exam_questions_section_question/i.test(e?.constraint || '')) {
          // Increment and retry
            qNum = (qNum || 0) + 1;
            continue;
        }
        throw e;
      }
    }
    if (!newId) throw new AppError('Failed to create question after retries', 500);
    await logAdminAction(req.user!.id, 'CREATE_QUESTION', 'exam', sec.rows[0].exam_id, { sectionId, questionType, questionNumber: qNum });
    res.status(201).json({ success: true, message: 'Question created', data: { id: newId, questionNumber: qNum } });
  })
);

// DELETE /api/admin/questions/:questionId - Delete a single question and its options & session answers
router.delete('/questions/:questionId',
  asyncHandler( async (req: Request, res: Response) => {
    const { questionId } = req.params;
    // Get section/exam for logging
    const info = await query('SELECT q.id, q.section_id, s.exam_id FROM exam_questions q JOIN exam_sections s ON q.section_id = s.id WHERE q.id = $1', [questionId]);
    if (info.rowCount === 0) throw createNotFoundError('Question');
    await query('BEGIN');
    try {
      await query('DELETE FROM exam_session_answers WHERE question_id = $1', [questionId]);
      await query('DELETE FROM exam_question_options WHERE question_id = $1', [questionId]);
      await query('DELETE FROM exam_questions WHERE id = $1', [questionId]);
      await query('COMMIT');
    } catch (e) {
      await query('ROLLBACK');
      throw e;
    }
    await logAdminAction(req.user!.id, 'DELETE_QUESTION', 'exam', info.rows[0].exam_id, { questionId });
    res.json({ success: true, message: 'Question deleted' });
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
  // durationMinutes fully deprecated; validation removed
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
          exam_id, section_type, title, description, max_score, section_order, instructions, audio_url, passage_text, heading_bank
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id
      `, [examId, s.sectionType, s.title, s.description || null, s.maxScore, s.sectionOrder, s.instructions || null, s.audioUrl || null, s.passageText || null, s.headingBank ? JSON.stringify(s.headingBank) : null]);
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
  body('groups.*.questionType').isIn(['multiple_choice', 'true_false', 'fill_blank', 'matching', 'short_answer', 'essay', 'writing_task1', 'speaking', 'speaking_task', 'drag_drop', 'table_fill_blank', 'table_drag_drop', 'simple_table']).withMessage('Invalid question type'),
  body('groups.*.start').isInt({ min: 1 }).withMessage('Start question number required'),
  body('groups.*.end').isInt({ min: 1 }).withMessage('End question number required'),
  body('groups.*.points').optional().isFloat({ min: 0 }).withMessage('Points must be >= 0'),
  body('groups.*.options').optional().isArray().withMessage('Options must be an array when provided'),
  body('groups.*.correctAnswers').optional().isArray().withMessage('correctAnswers must be an array when provided'),
  body('groups.*.questionTexts').optional().isArray().withMessage('questionTexts must be an array when provided'),
  body('groups.*.fillMissing').optional().isBoolean(),
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
      // Pre-check for existing question numbers in requested range to avoid partial inserts & 500 errors
      const existingNums = await query(
        'SELECT question_number FROM exam_questions WHERE section_id = $1 AND question_number BETWEEN $2 AND $3 ORDER BY question_number',
        [sectionId, startNum, endNum]
      );
      const existingSet = new Set(existingNums.rows.map((r: any) => r.question_number));
      if (existingSet.size > 0 && !g.fillMissing) {
        const nums = Array.from(existingSet.values()).sort((a:any,b:any)=>a-b).join(',');
        throw new AppError(`Cannot create questions. Numbers already exist in this section: ${nums}`, 409);
      }
      // Map client-friendly types to DB enum values
      const typeMap: Record<string, string> = {
        speaking: 'speaking_task',
      };
      const dbQuestionType = (typeMap[g.questionType] || g.questionType) as string;
      // Special handling for drag_drop ranges: first question is the anchor (manages tokens/options),
      // subsequent ones become group members with metadata.groupMemberOf pointing at anchor id.
      let dragDropAnchorId: string | null = null;
      for (let num = startNum; num <= endNum; num++) {
        if (existingSet.has(num)) {
          // Skip existing when fillMissing true
          if (g.fillMissing) continue; else break;
        }
        const questionText = (Array.isArray(g.questionTexts) ? g.questionTexts[num - startNum] : g.questionText) || '';
        const points = g.points || 1.0;
        let metadata: any = null;
        if (dbQuestionType === 'drag_drop') {
          if (num === startNum) {
            // Anchor: provide a default layout if not specified by client and store group range end
            metadata = { layout: (g.layout || 'rows'), groupRangeEnd: endNum };
          } else {
            if (!dragDropAnchorId) {
              throw new AppError('Internal error creating drag_drop group (missing anchor id)', 500);
            }
            metadata = { groupMemberOf: dragDropAnchorId };
          }
        } else if (dbQuestionType === 'essay') {
          // Auto-assign writing part for convenience when creating ranges: first -> part 1, second -> part 2
          // If more than 2 created, fallback to part 1 for the rest; admins can adjust later.
          const idxWithin = num - startNum; // 0-based
          const part = idxWithin === 0 ? 1 : (idxWithin === 1 ? 2 : 1);
          metadata = { ...(g.metadata || {}), writingPart: part };
        }

        const rQ = await query(`
          INSERT INTO exam_questions (
            section_id, question_type, question_text, question_number, points, metadata
          ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
        `, [
          sectionId,
          dbQuestionType,
          questionText,
          num,
          points,
          metadata ? JSON.stringify(metadata) : null
        ]);
        const questionId = rQ.rows[0].id;
        if (dbQuestionType === 'drag_drop' && num === startNum) {
          dragDropAnchorId = questionId;
        }

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

        // For drag_drop anchors with no provided options, seed a small default token set for convenience
        if (!options && dbQuestionType === 'drag_drop' && num === startNum) {
          options = ['A','B','C','D'];
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
  rateLimitByUser(20, 3600), // 20 tickets per hour (3600s)
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
      // Keep ticket code <= 20 chars to satisfy DB constraint (VARCHAR(20))
      const tsPart = Date.now().toString(36).toUpperCase().slice(-6); // 6 chars
      const randPart = Math.random().toString(36).toUpperCase().slice(2, 6); // 4 chars
      const prefixPart = ticketPrefix.slice(0, 5); // up to 5 chars
      const ticketCode = `${prefixPart}-${tsPart}-${randPart}`; // ~5+1+6+1+4 = 17
      
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
        t.exam_id,
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
        id: ticket.exam_id,
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
      userId,
      todayOnly
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
        t.ticket_code, t.issued_to_name, t.issued_to_email
      FROM exam_sessions es
      LEFT JOIN users u ON es.user_id = u.id
      JOIN exams e ON es.exam_id = e.id
      LEFT JOIN tickets t ON es.ticket_id = t.id
      ${whereClause}
      ${String(todayOnly) === 'true' ? " AND COALESCE(es.submitted_at, es.created_at) >= date_trunc('day', now()) AND COALESCE(es.submitted_at, es.created_at) < date_trunc('day', now()) + INTERVAL '1 day'" : ''}
      ORDER BY COALESCE(es.submitted_at, es.created_at) DESC
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
      ${String(todayOnly) === 'true' ? " AND COALESCE(es.submitted_at, es.created_at) >= date_trunc('day', now()) AND COALESCE(es.submitted_at, es.created_at) < date_trunc('day', now()) + INTERVAL '1 day'" : ''}
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
      ticketCode: session.ticket_code,
      ticketIssuedToName: session.issued_to_name,
      ticketIssuedToEmail: session.issued_to_email
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

// POST /api/admin/sessions/:sessionId/stop - Force stop an in-progress or pending session (mark expired + submitted_at if desired)
router.post('/sessions/:sessionId/stop', asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const sess = await query('SELECT id, status FROM exam_sessions WHERE id = $1', [sessionId]);
  if (sess.rowCount === 0) throw createNotFoundError('Exam session');
  const status = sess.rows[0].status;
  if (status === 'submitted') {
    return res.status(400).json({ success: false, message: 'Session already submitted' });
  }
  await query(`UPDATE exam_sessions SET status = 'expired', submitted_at = COALESCE(submitted_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [sessionId]);
  await logAdminAction(req.user!.id, 'STOP_SESSION', 'session', sessionId, { previousStatus: status });
  res.json({ success: true, message: 'Session stopped', data: { status: 'expired' } });
}));

// DELETE /api/admin/sessions/:sessionId - Remove a session and its answers (only if not submitted OR force=true)
router.delete('/sessions/:sessionId', asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const force = (req.query.force || '').toString() === 'true';
  const sess = await query('SELECT id, status FROM exam_sessions WHERE id = $1', [sessionId]);
  if (sess.rowCount === 0) throw createNotFoundError('Exam session');
  if (sess.rows[0].status === 'submitted' && !force) {
    return res.status(400).json({ success: false, message: 'Cannot delete submitted session without force=true' });
  }
  await query('BEGIN');
  try {
    await query('DELETE FROM exam_session_answers WHERE session_id = $1', [sessionId]);
    await query('DELETE FROM exam_sessions WHERE id = $1', [sessionId]);
    await query('COMMIT');
  } catch (e) {
    await query('ROLLBACK');
    throw e;
  }
  await logAdminAction(req.user!.id, 'DELETE_SESSION', 'session', sessionId, { force });
  res.json({ success: true, message: 'Session deleted' });
}));

// GET /api/admin/sessions/:sessionId/results - Get results for any session (including ticket-based anonymous)
router.get('/sessions/:sessionId/results',
  asyncHandler(async (req: Request, res: Response) => {
    const { sessionId } = req.params;

    // Fetch session with exam and optional user/ticket info
    const sessionResult = await query(`
      SELECT es.id, es.status, es.started_at, es.submitted_at, es.total_score,
             es.percentage_score, es.is_passed, es.time_spent_seconds,
             es.exam_id, es.ticket_id,
             e.title as exam_title, e.exam_type, e.passing_score, e.duration_minutes,
             u.email as user_email, u.first_name, u.last_name,
             t.ticket_code, t.issued_to_name
      FROM exam_sessions es
      JOIN exams e ON es.exam_id = e.id
      LEFT JOIN users u ON es.user_id = u.id
      LEFT JOIN tickets t ON es.ticket_id = t.id
      WHERE es.id = $1
    `, [sessionId]);

    if (sessionResult.rows.length === 0) {
      throw createNotFoundError('Exam session');
    }

    const session = sessionResult.rows[0];

    if (session.status !== 'submitted') {
      throw new AppError('Session not yet submitted', 400);
    }

    // Get answers
    const answersResult = await query(`
      SELECT esa.question_id, esa.student_answer, esa.is_correct, esa.points_earned,
             eq.question_text, eq.correct_answer, eq.explanation, eq.points,
             eq.metadata AS question_metadata,
             esec.section_type, esec.title as section_title, eq.question_number, eq.question_type
      FROM exam_session_answers esa
      JOIN exam_questions eq ON esa.question_id = eq.id
      JOIN exam_sections esec ON eq.section_id = esec.id
      WHERE esa.session_id = $1
      ORDER BY esec.section_order, eq.question_number
    `, [sessionId]);

    const answers = answersResult.rows.map((row: any) => {
      let parsedStudent: any = null;
      try { parsedStudent = JSON.parse(row.student_answer || 'null'); } catch { parsedStudent = row.student_answer; }
      return {
        questionId: row.question_id,
        questionNumber: row.question_number,
        questionType: row.question_type,
        questionText: row.question_text,
        questionMetadata: row.question_metadata,
        studentAnswer: parsedStudent,
        isCorrect: row.is_correct,
        pointsEarned: row.points_earned,
        maxPoints: row.points,
        correctAnswer: row.correct_answer,
        explanation: row.explanation,
        sectionType: row.section_type,
        sectionTitle: row.section_title
      };
    });

    res.json({
      success: true,
      data: {
        session: {
          id: session.id,
            status: session.status,
            startedAt: session.started_at,
            submittedAt: session.submitted_at,
            totalScore: session.total_score,
            percentageScore: session.percentage_score,
            isPassed: session.is_passed,
            timeSpentSeconds: session.time_spent_seconds,
            ticketCode: session.ticket_code,
            user: session.user_email ? { email: session.user_email, name: `${session.first_name} ${session.last_name}` } : (session.issued_to_name ? { email: null, name: `${session.issued_to_name} (ticket)` } : null)
        },
        exam: {
          id: session.exam_id,
          title: session.exam_title,
          type: session.exam_type,
          passingScore: session.passing_score,
          durationMinutes: session.duration_minutes
        },
        answers
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