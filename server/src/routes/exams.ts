import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { query, logger } from '../config/database-no-redis';
import { asyncHandler, createValidationError, createNotFoundError, AppError } from '../middleware/errorHandler';
import { authMiddleware, optionalAuth, requireRole, rateLimitByUser } from '../middleware/auth';

const router = Router();

// Helper function to check validation errors
const checkValidationErrors = (req: Request): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw createValidationError(errors.array());
  }
};

// GET /api/exams - List available exams (public/authenticated)
router.get('/',
  optionalAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { page = 1, limit = 10, type, search } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let whereClause = 'WHERE e.is_active = true';
    const queryParams = [];
    let paramCount = 1;

    // Filter by exam type
    if (type && ['academic', 'general_training'].includes(type as string)) {
      whereClause += ` AND e.exam_type = $${paramCount++}`;
      queryParams.push(type);
    }

    // Search filter
    if (search) {
      whereClause += ` AND (e.title ILIKE $${paramCount++} OR e.description ILIKE $${paramCount++})`;
      queryParams.push(`%${search}%`, `%${search}%`);
    }

    // Get exams with section count
    const examsQuery = `
      SELECT 
        e.id, e.title, e.description, e.exam_type, e.duration_minutes,
        e.passing_score, e.max_attempts, e.instructions, e.created_at,
        COUNT(es.id) as section_count
      FROM exams e
      LEFT JOIN exam_sections es ON e.id = es.exam_id
      ${whereClause}
      GROUP BY e.id, e.title, e.description, e.exam_type, e.duration_minutes,
               e.passing_score, e.max_attempts, e.instructions, e.created_at
      ORDER BY e.created_at DESC
      LIMIT $${paramCount++} OFFSET $${paramCount++}
    `;

    queryParams.push(limit, offset);

    const examsResult = await query(examsQuery, queryParams);

    // Get total count
    const countQuery = `
      SELECT COUNT(DISTINCT e.id) 
      FROM exams e 
      ${whereClause}
    `;
    const countResult = await query(countQuery, queryParams.slice(0, -2)); // Remove limit and offset

    const exams = examsResult.rows.map((exam: any) => ({
      id: exam.id,
      title: exam.title,
      description: exam.description,
      examType: exam.exam_type,
      durationMinutes: exam.duration_minutes,
      passingScore: exam.passing_score,
      maxAttempts: exam.max_attempts,
      instructions: exam.instructions,
      sectionCount: parseInt(exam.section_count),
      createdAt: exam.created_at
    }));

    const totalCount = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalCount / Number(limit));

    res.json({
      success: true,
      data: {
        exams,
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

// GET /api/exams/:id - Get exam details
router.get('/:id',
  optionalAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const includeQuestions = req.query.questions === 'true';
    const sectionFilter = req.query.section as string | undefined; // reading | listening | writing | speaking
    const sessionIdParam = (req.query.session || req.query.sid) as string | undefined;

    // Get exam details
    const examResult = await query(`
      SELECT id, title, description, exam_type, duration_minutes,
             passing_score, max_attempts, instructions, is_active, created_at
      FROM exams 
      WHERE id = $1 AND is_active = true
    `, [id]);

    if (examResult.rows.length === 0) {
      throw createNotFoundError('Exam');
    }

    const exam = examResult.rows[0];

    // Get sections
    let sectionsSql = `
      SELECT id, section_type, title, description, duration_minutes,
             max_score, section_order, instructions, audio_url, passage_text, heading_bank
      FROM exam_sections 
      WHERE exam_id = $1`;
    const params: any[] = [id];
    if (sectionFilter && ['reading','listening','writing','speaking'].includes(sectionFilter)) {
      sectionsSql += ` AND section_type = $2`;
      params.push(sectionFilter);
    }
    sectionsSql += ` ORDER BY section_order`;
    const sectionsResult = await query(sectionsSql, params);

    const sections = [];
    // If not authenticated but a sessionId was provided, verify it belongs to this exam to permit question access.
    let sessionValidatedForQuestions = false;
    if (!req.user && includeQuestions && sessionIdParam) {
      const sessCheck = await query(`SELECT id, status, started_at FROM exam_sessions WHERE id = $1 AND exam_id = $2 AND status IN ('pending','in_progress') LIMIT 1`, [sessionIdParam, id]);
      sessionValidatedForQuestions = sessCheck.rows.length > 0;
      // Auto-start pending ticket-based session when questions are requested
      if (sessionValidatedForQuestions) {
        const s = sessCheck.rows[0];
        if (s.status === 'pending' || !s.started_at) {
          await query(`
            UPDATE exam_sessions
            SET started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
                status = CASE WHEN status = 'pending' THEN 'in_progress' ELSE status END
            WHERE id = $1
          `, [sessionIdParam]);
          logger.info('Auto-started ticket session on question fetch', { sessionId: sessionIdParam, examId: id });
        }
      }
    }

    const allowQuestions = !!req.user || sessionValidatedForQuestions;

    for (const section of sectionsResult.rows) {
      const sectionData = {
        id: section.id,
        sectionType: section.section_type,
        title: section.title,
        description: section.description,
        durationMinutes: section.duration_minutes,
        maxScore: section.max_score,
        sectionOrder: section.section_order,
        instructions: section.instructions,
        audioUrl: section.audio_url,
        passageText: section.passage_text,
        headingBank: section.heading_bank,
        questions: []
      };

      // Include questions if requested and user is authenticated
  if (includeQuestions && allowQuestions) {
        const questionsResult = await query(`
          SELECT id, question_type, question_text, question_number, points,
                 time_limit_seconds, explanation, audio_url, image_url, metadata, correct_answer
          FROM exam_questions 
          WHERE section_id = $1 
          ORDER BY question_number
        `, [section.id]);

        for (const question of questionsResult.rows) {
          const questionData: any = {
            id: question.id,
            questionType: question.question_type,
            questionText: question.question_text,
            questionNumber: question.question_number,
            points: question.points,
            timeLimitSeconds: question.time_limit_seconds,
            explanation: question.explanation,
            audioUrl: question.audio_url,
            imageUrl: question.image_url,
            metadata: question.metadata,
            options: []
          };

          // Include correctAnswer only for admins
          if (req.user && ['admin','super_admin'].includes((req.user as any).role)) {
            questionData.correctAnswer = question.correct_answer;
          }

          // Get question options for multiple choice-like questions
          if (['multiple_choice', 'multi_select', 'matching', 'drag_drop'].includes(question.question_type)) {
            const optionsResult = await query(`
              SELECT id, option_text, option_letter, option_order
              FROM exam_question_options 
              WHERE question_id = $1 
              ORDER BY option_order
            `, [question.id]);

            questionData.options = optionsResult.rows.map((option: any) => ({
              id: option.id,
              text: option.option_text,
              letter: option.option_letter,
              order: option.option_order
            }));
          }

          (sectionData.questions as any[]).push(questionData);
        }
      }

      sections.push(sectionData);
    }

    // Check user's attempt history if authenticated
    let userAttempts = null;
    if (req.user) {
      const attemptsResult = await query(`
        SELECT COUNT(*) as attempt_count,
               MAX(total_score) as best_score,
               MAX(percentage_score) as best_percentage,
               MAX(CASE WHEN is_passed = true THEN 1 ELSE 0 END) as has_passed
        FROM exam_sessions 
        WHERE user_id = $1 AND exam_id = $2 AND status = 'submitted'
      `, [req.user.id, id]);

      if (attemptsResult.rows.length > 0) {
        const attempts = attemptsResult.rows[0];
        userAttempts = {
          attemptCount: parseInt(attempts.attempt_count),
          bestScore: attempts.best_score,
          bestPercentage: attempts.best_percentage,
          hasPassed: attempts.has_passed === 1,
          canAttempt: parseInt(attempts.attempt_count) < exam.max_attempts
        };
      }
    }

    const examDetails = {
      id: exam.id,
      title: exam.title,
      description: exam.description,
      examType: exam.exam_type,
      durationMinutes: exam.duration_minutes,
      passingScore: exam.passing_score,
      maxAttempts: exam.max_attempts,
      instructions: exam.instructions,
      isActive: exam.is_active,
      createdAt: exam.created_at,
      sections,
      userAttempts
    };

    res.json({
      success: true,
      data: { exam: examDetails }
    });
  })
);

// POST /api/exams/:id/start - Start an exam session
router.post('/:id/start',
  optionalAuth,
  body('ticketCode')
    .optional()
    .trim()
    .isLength({ min: 5, max: 20 })
    .withMessage('Invalid ticket code'),
  body('section')
    .optional()
    .isIn(['reading','listening','writing','speaking'])
    .withMessage('Invalid section'),
  asyncHandler(async (req: Request, res: Response) => {
    checkValidationErrors(req);

    const { id: examId } = req.params;
    const { ticketCode, section } = req.body;
    const userId = req.user?.id || null;

    // Verify exam exists and is active
    const examResult = await query(`
      SELECT id, title, duration_minutes, max_attempts, is_active
      FROM exams 
      WHERE id = $1
    `, [examId]);

    if (examResult.rows.length === 0) {
      throw createNotFoundError('Exam');
    }

    const exam = examResult.rows[0];

    if (!exam.is_active) {
      throw new AppError('Exam is not currently available', 400);
    }

    // Removed max attempts restriction: students can start unlimited sessions

    // Check for existing active session
    if (userId) {
      const activeSessionResult = await query(`
        SELECT id, status, started_at FROM exam_sessions 
        WHERE user_id = $1 AND exam_id = $2 AND status IN ('pending', 'in_progress')
          AND expires_at > CURRENT_TIMESTAMP
        ORDER BY created_at DESC
        LIMIT 1
      `, [userId, examId]);

      if (activeSessionResult.rows.length > 0) {
        const existing = activeSessionResult.rows[0];
        // If still pending / not started, transition to in_progress & set started_at
        if (existing.status === 'pending' || !existing.started_at) {
          await query(`
            UPDATE exam_sessions
            SET started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
                status = CASE WHEN status = 'pending' THEN 'in_progress' ELSE status END
            WHERE id = $1
          `, [existing.id]);
          logger.info('Started previously pending session', { userId, examId, sessionId: existing.id });
        } else {
          logger.info('Existing in_progress session reused', { userId, examId, sessionId: existing.id });
        }
        return res.status(200).json({
            success: true,
            message: 'Existing active session found',
            data: { sessionId: existing.id, examId, resumed: true }
        });
      }
    }

    // Validate ticket if provided
    let ticketId = null;
    if (ticketCode) {
      const ticketResult = await query(`
        SELECT id, exam_id, max_uses, current_uses, status, valid_until
        FROM tickets 
        WHERE ticket_code = $1
      `, [ticketCode]);

      if (ticketResult.rows.length === 0) {
        throw new AppError('Invalid ticket code', 400);
      }

      const ticket = ticketResult.rows[0];

      if (ticket.status !== 'active') {
        throw new AppError('Ticket is not active', 400);
      }

      if (ticket.exam_id !== examId) {
        throw new AppError('Ticket is not valid for this exam', 400);
      }

      if (new Date(ticket.valid_until) < new Date()) {
        throw new AppError('Ticket has expired', 400);
      }

      if (ticket.current_uses >= ticket.max_uses) {
        throw new AppError('Ticket usage limit reached', 400);
      }

      ticketId = ticket.id;

      // Update ticket usage
      await query(`
        UPDATE tickets 
        SET current_uses = current_uses + 1 
        WHERE id = $1
      `, [ticketId]);

      // Log ticket usage
      await query(`
        INSERT INTO ticket_usage (ticket_id, user_id, ip_address, user_agent)
        VALUES ($1, $2, $3, $4)
      `, [ticketId, userId, req.ip, req.get('User-Agent')]);
    }

    // Create exam session (support section-only)
    let effectiveMinutes = exam.duration_minutes;
    if (section) {
      const secRes = await query(`SELECT duration_minutes FROM exam_sections WHERE exam_id = $1 AND section_type = $2 LIMIT 1`, [examId, section]);
      if (secRes.rows.length > 0) effectiveMinutes = secRes.rows[0].duration_minutes;
    }
    const sessionExpiresAt = new Date(Date.now() + (effectiveMinutes * 60 * 1000) + (5 * 60 * 1000));

    const sessionResult = await query(`
      INSERT INTO exam_sessions (
        user_id, exam_id, ticket_id, status, started_at, expires_at, browser_info
      ) VALUES ($1, $2, $3, 'in_progress', CURRENT_TIMESTAMP, $4, $5)
      RETURNING id, started_at, expires_at, created_at
    `, [
      userId,
      examId,
      ticketId,
      sessionExpiresAt,
      JSON.stringify({
        userAgent: req.get('User-Agent'),
        ip: req.ip,
        timestamp: new Date().toISOString(),
        section: section || null
      })
    ]);

    const session = sessionResult.rows[0];

    logger.info('Exam session created', {
      userId,
      examId,
      sessionId: session.id,
      ticketCode: ticketCode || 'none'
    });

    res.status(201).json({
      success: true,
      message: 'Exam session created successfully',
      data: {
        sessionId: session.id,
        examId,
        startedAt: session.started_at,
        expiresAt: session.expires_at,
        createdAt: session.created_at
      }
    });
  })
);

// POST /api/exams/sessions/:sessionId/submit - Submit exam answers
router.post('/sessions/:sessionId/submit',
  optionalAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { sessionId } = req.params;
    const { answers } = req.body;
    const userId = req.user?.id || null;

    // Fetch session (different rules if authenticated vs ticket-based anonymous)
    let sessionResult;
    if (userId) {
      sessionResult = await query(`
        SELECT es.id, es.exam_id, es.status, es.expires_at, es.started_at, es.user_id, es.ticket_id,
               e.title as exam_title, e.passing_score
        FROM exam_sessions es
        JOIN exams e ON es.exam_id = e.id
        WHERE es.id = $1 AND es.user_id = $2
      `, [sessionId, userId]);
    } else {
      // Allow only ticket-based sessions without user
      sessionResult = await query(`
        SELECT es.id, es.exam_id, es.status, es.expires_at, es.started_at, es.user_id, es.ticket_id,
               e.title as exam_title, e.passing_score
        FROM exam_sessions es
        JOIN exams e ON es.exam_id = e.id
        WHERE es.id = $1 AND es.ticket_id IS NOT NULL AND es.user_id IS NULL
      `, [sessionId]);
    }

    if (sessionResult.rows.length === 0) {
      // Distinguish not found vs unauthorized attempt on someone else's session
      if (!userId) {
        throw createNotFoundError('Exam session');
      }
      throw createNotFoundError('Exam session');
    }

    const session = sessionResult.rows[0];

    if (session.status === 'submitted') {
      throw new AppError('Exam has already been submitted', 400);
    }

    // Allow late submission: proceed even if status shows expired or past expires_at
    const isExpiredNow = session.status === 'expired' || new Date(session.expires_at) < new Date();

    // Process answers and calculate score
    // This is a simplified scoring - you'll want to implement proper scoring logic
    let totalScore = 0;
    let maxPossibleScore = 0;

    if (answers && Array.isArray(answers)) {
      for (const answer of answers) {
        const { questionId, studentAnswer } = answer;

        // Get question details and correct answer
        const questionResult = await query(`
          SELECT eq.points, eq.correct_answer, eq.question_type, es.max_score, es.heading_bank
          FROM exam_questions eq
          JOIN exam_sections es ON eq.section_id = es.id
          WHERE eq.id = $1 AND es.exam_id = $2
        `, [questionId, session.exam_id]);

        if (questionResult.rows.length > 0) {
          const question = questionResult.rows[0];
          maxPossibleScore += parseFloat(question.points);

          // Store answer
          await query(`
            INSERT INTO exam_session_answers (
              session_id, question_id, student_answer, answered_at
            ) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
            ON CONFLICT (session_id, question_id) 
            DO UPDATE SET student_answer = EXCLUDED.student_answer, answered_at = CURRENT_TIMESTAMP
          `, [sessionId, questionId, JSON.stringify(studentAnswer)]);

          // Simple scoring for MCQ / Matching / True-False / Fill-blank by string equality (case-insensitive, trimmed)
          const normalize = (v: any) => String(v ?? '').trim().toLowerCase();
          const expected = question.correct_answer ? normalize(question.correct_answer) : '';
          let received = normalize(studentAnswer);

          let isCorrect = false;
          if (question.question_type === 'multiple_choice' || question.question_type === 'matching' || question.question_type === 'drag_drop') {
            // Special handling for matching: if student selected an option letter (A, B, C ...)
            // but correct answers are stored as heading letters (e.g., roman numerals: i, ii, iii),
            // map the option letter position to the heading bank letter before comparing.
            if (question.question_type === 'matching' && received && /^[a-z]$/.test(received)) {
              try {
                const bank = question.heading_bank ? JSON.parse(question.heading_bank) : null;
                const options = Array.isArray(bank?.options) ? bank.options : [];
                const idx = received.charCodeAt(0) - 97; // a->0
                const mapped = options[idx]?.letter ? normalize(options[idx].letter) : '';
                if (mapped) {
                  received = mapped;
                }
              } catch (_e) {
                // ignore parse errors; fall back to raw compare
              }
            }
            isCorrect = expected !== '' && received === expected;
          } else if (question.question_type === 'multi_select') {
            // Correct answer stored as pipe list (e.g. "A|C") or JSON array ["A","C"]. Student answer expected as array or joined string.
            let expectedSet: string[] = [];
            try {
              if (question.correct_answer && question.correct_answer.trim().startsWith('[')) {
                const arr = JSON.parse(question.correct_answer);
                if (Array.isArray(arr)) expectedSet = arr.map((x:any)=>normalize(x));
              }
            } catch {}
            if (expectedSet.length === 0 && question.correct_answer) {
              expectedSet = question.correct_answer.split('|').map((p:string)=>normalize(p));
            }
            let studentSet: string[] = [];
            if (Array.isArray(studentAnswer)) studentSet = (studentAnswer as any[]).map(v=>normalize(v));
            else if (typeof studentAnswer === 'string') studentSet = studentAnswer.split('|').map(p=>normalize(p));
            // Require exact two (or expected length) and same members ignoring order
            expectedSet = Array.from(new Set(expectedSet));
            studentSet = Array.from(new Set(studentSet));
            if (expectedSet.length === studentSet.length && expectedSet.every(v => studentSet.includes(v))) {
              isCorrect = true;
            }
          } else if (question.question_type === 'true_false') {
            // Accept synonyms like T/F and not given variations
            const map: Record<string, string> = { 't': 'true', 'f': 'false', 'ng': 'not given', 'notgiven': 'not given' };
            const rec = map[received] || received;
            const exp = map[expected] || expected;
            isCorrect = exp !== '' && rec === exp;
          } else if (question.question_type === 'fill_blank') {
            // Support multiple acceptable answers:
            // 1) pipe-delimited string: answer1|answer2|answer3
            // 2) JSON array stored in correct_answer: ["answer1","answer2"]
            // Matching is case-insensitive & trimmed. Numeric answers allow leading/trailing zeros differences.
            let accepted: string[] = [];
            try {
              if (question.correct_answer && question.correct_answer.trim().startsWith('[')) {
                const arr = JSON.parse(question.correct_answer);
                if (Array.isArray(arr)) accepted = arr.map((a: any) => normalize(a));
              }
            } catch (_) { /* ignore JSON parse errors */ }
            if (accepted.length === 0 && question.correct_answer) {
              accepted = question.correct_answer.split('|').map((p: string) => normalize(p));
            }
            if (accepted.length === 0 && expected) accepted = [expected];
            // Numeric normalization: if all accepted numeric, compare as numbers too
            const recNum = Number(received);
            const numericMode = accepted.every(a => /^[-+]?(\d+\.?\d*|\.\d+)$/.test(a));
            // If metadata contains placeholders count and studentAnswer is an array -> all must be individually correct (AND)
            if (Array.isArray(studentAnswer)) {
              // Each element may have its own accepted set if correct_answer stored as JSON array of arrays, fallback to global accepted
              try {
                const meta = question.metadata ? JSON.parse(question.metadata) : null;
                const placeholders: any[] = Array.isArray(meta?.placeholders) ? meta.placeholders : [];
                // If correct_answer is JSON array of arrays, parse
                let parsedCorrect: any = null;
                try { parsedCorrect = question.correct_answer ? JSON.parse(question.correct_answer) : null; } catch { parsedCorrect = null; }
                isCorrect = (studentAnswer as any[]).every((ans, idx) => {
                  const recv = normalize(ans);
                  let localAccepted = accepted;
                  if (Array.isArray(parsedCorrect) && Array.isArray(parsedCorrect[idx])) {
                    localAccepted = parsedCorrect[idx].map((x: any) => normalize(x));
                  }
                  const num = Number(recv);
                  const localNumeric = localAccepted.every(a => /^[-+]?(\d+\.?\d*|\.\d+)$/.test(a));
                  return localAccepted.some(a => a === recv || (localNumeric && !isNaN(num) && Number(a) === num));
                });
              } catch { isCorrect = false; }
            } else {
              isCorrect = accepted.some(a => a === received || (numericMode && !isNaN(recNum) && Number(a) === recNum));
            }
          }

          if (isCorrect) {
            totalScore += parseFloat(question.points);
            await query(`
              UPDATE exam_session_answers 
              SET is_correct = true, points_earned = $1
              WHERE session_id = $2 AND question_id = $3
            `, [question.points, sessionId, questionId]);
          } else {
            await query(`
              UPDATE exam_session_answers 
              SET is_correct = false, points_earned = 0
              WHERE session_id = $1 AND question_id = $2
            `, [sessionId, questionId]);
          }
        }
      }
    }

    // Calculate percentage and pass/fail
    const percentageScore = maxPossibleScore > 0 ? (totalScore / maxPossibleScore) * 100 : 0;
    const isPassed = percentageScore >= parseFloat(session.passing_score);

    // Calculate time spent
    const startedAt = session.started_at || new Date();
    const timeSpentSeconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);

    // Update session; if it was expired, still mark as submitted
    await query(`
      UPDATE exam_sessions 
      SET status = 'submitted', submitted_at = CURRENT_TIMESTAMP, 
          total_score = $1, percentage_score = $2, is_passed = $3,
          time_spent_seconds = $4
      WHERE id = $5
    `, [totalScore, percentageScore, isPassed, timeSpentSeconds, sessionId]);

    logger.info('Exam submitted', {
      userId: userId || 'anonymous-ticket',
      sessionId,
      examId: session.exam_id,
      totalScore,
      percentageScore,
      isPassed,
      timeSpentSeconds
    });

    res.json({
      success: true,
      message: 'Exam submitted successfully',
      data: {
        sessionId,
        totalScore,
        percentageScore,
        isPassed,
        timeSpentSeconds,
        examTitle: session.exam_title
      }
    });
  })
);

// GET /api/exams/sessions/:sessionId/results - Get exam results
router.get('/sessions/:sessionId/results',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const { sessionId } = req.params;
    const userId = req.user!.id;

    // Get session results
    const sessionResult = await query(`
      SELECT es.id, es.status, es.started_at, es.submitted_at, es.total_score,
             es.percentage_score, es.is_passed, es.time_spent_seconds,
             e.title as exam_title, e.exam_type, e.passing_score, e.duration_minutes
      FROM exam_sessions es
      JOIN exams e ON es.exam_id = e.id
      WHERE es.id = $1 AND es.user_id = $2 AND es.status = 'submitted'
    `, [sessionId, userId]);

    if (sessionResult.rows.length === 0) {
      throw createNotFoundError('Exam results');
    }

    const session = sessionResult.rows[0];

    // Get detailed answers
    const answersResult = await query(`
      SELECT esa.question_id, esa.student_answer, esa.is_correct, esa.points_earned,
             eq.question_text, eq.correct_answer, eq.explanation, eq.points,
             es.section_type, es.title as section_title
      FROM exam_session_answers esa
      JOIN exam_questions eq ON esa.question_id = eq.id
      JOIN exam_sections es ON eq.section_id = es.id
      WHERE esa.session_id = $1
      ORDER BY es.section_order, eq.question_number
    `, [sessionId]);

    const results = {
      session: {
        id: session.id,
        status: session.status,
        startedAt: session.started_at,
        submittedAt: session.submitted_at,
        totalScore: session.total_score,
        percentageScore: session.percentage_score,
        isPassed: session.is_passed,
        timeSpentSeconds: session.time_spent_seconds
      },
      exam: {
        title: session.exam_title,
        type: session.exam_type,
        passingScore: session.passing_score,
        durationMinutes: session.duration_minutes
      },
      answers: answersResult.rows.map((answer: any) => ({
        questionId: answer.question_id,
        questionText: answer.question_text,
        studentAnswer: JSON.parse(answer.student_answer || 'null'),
        isCorrect: answer.is_correct,
        pointsEarned: answer.points_earned,
        maxPoints: answer.points,
        correctAnswer: answer.correct_answer,
        explanation: answer.explanation,
        sectionType: answer.section_type,
        sectionTitle: answer.section_title
      }))
    };

    res.json({
      success: true,
      data: { results }
    });
  })
);

// GET /api/exams/sessions/active - List user's active (not submitted) sessions
router.get('/sessions/active',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const result = await query(`
      SELECT es.id, es.exam_id, es.status, es.expires_at, es.created_at, es.browser_info,
             e.title as exam_title, e.exam_type, e.duration_minutes
      FROM exam_sessions es
      JOIN exams e ON es.exam_id = e.id
      WHERE es.user_id = $1
        AND es.status IN ('pending','in_progress')
        AND es.expires_at > CURRENT_TIMESTAMP
      ORDER BY es.created_at DESC
    `, [userId]);

    const sessions = result.rows.map((row: any) => ({
      id: row.id,
      examId: row.exam_id,
      status: row.status,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      browserInfo: row.browser_info,
      exam: {
        title: row.exam_title,
        type: row.exam_type,
        durationMinutes: row.duration_minutes,
      }
    }));

    res.json({ success: true, data: { sessions } });
  })
);

// DELETE /api/exams/sessions/:sessionId - Discard an active session
router.delete('/sessions/:sessionId',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const { sessionId } = req.params;
    const userId = req.user!.id;

    // Mark only user's active session as expired (soft discard)
    const result = await query(`
      UPDATE exam_sessions
      SET status = 'expired'
      WHERE id = $1 AND user_id = $2 AND status IN ('pending','in_progress')
      RETURNING id
    `, [sessionId, userId]);

    if (result.rowCount === 0) {
      throw createNotFoundError('Active session');
    }

    res.json({ success: true, message: 'Session discarded' });
  })
);

export default router;