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
     passing_score, max_attempts, instructions, audio_url, is_active, created_at
      FROM exams 
      WHERE id = $1 AND is_active = true
    `, [id]);

    if (examResult.rows.length === 0) {
      throw createNotFoundError('Exam');
    }

    const exam = examResult.rows[0];

    // Get sections
    let sectionsSql = `
      SELECT id, section_type, title, description,
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
        // durationMinutes removed (global exam duration applies)
        durationMinutes: null as any,
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

          // Fallback: ensure table container questions always expose a metadata.table structure
          try {
            if ((questionData.questionType === 'table_fill_blank' || questionData.questionType === 'table_drag_drop')) {
              // metadata may be stringified in some drivers or already parsed
              let meta: any = questionData.metadata;
              if (typeof meta === 'string') {
                try { meta = JSON.parse(meta); } catch { meta = {}; }
              }
              if (!meta || typeof meta !== 'object') meta = {};
              if (!meta.table || !Array.isArray(meta.table?.rows)) {
                meta.table = meta.table && Array.isArray(meta.table.rows) ? meta.table : { rows: [[""]] };
              }
              questionData.metadata = meta;
            }
          } catch (e) {
            logger.warn('Failed to normalize table_* metadata', { questionId: question.id, error: (e as any)?.message });
          }

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
      audioUrl: exam.audio_url,
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
  // Section-level duration deprecated; always use exam.duration_minutes
  const effectiveMinutes = exam.duration_minutes;
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

  if (answers && Array.isArray(answers) && answers.length) {
      const normalize = (v: any) => String(v ?? '').trim().toLowerCase();
      const answerMap: Record<string, any> = {};
      for (const a of answers) answerMap[a.questionId] = a.studentAnswer;
      const ids = Object.keys(answerMap);
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
      const questionRows = (await query(`
        SELECT eq.id, eq.points, eq.correct_answer, eq.question_type, eq.metadata, eq.question_number,
               es.heading_bank
        FROM exam_questions eq
        JOIN exam_sections es ON eq.section_id = es.id
        WHERE eq.id IN (${placeholders}) AND es.exam_id = $${ids.length + 1}
      `, [...ids, session.exam_id])).rows;
  const byId: Record<string, any> = {}; questionRows.forEach((q: any) => { byId[q.id] = q; });
      // Build grouping anchors (metadata.groupRangeEnd or groupMemberOf)
      const anchors: Record<string, { anchor: any; members: any[] }> = {};
      for (const q of questionRows) {
        let meta: any = null; try { meta = q.metadata ? JSON.parse(q.metadata) : null; } catch {}
        if (meta?.groupMemberOf) {
          anchors[meta.groupMemberOf] = anchors[meta.groupMemberOf] || { anchor: null, members: [] };
          anchors[meta.groupMemberOf].members.push(q);
        } else if (meta?.groupRangeEnd) {
          anchors[q.id] = anchors[q.id] || { anchor: q, members: [] };
        }
      }
      for (const q of questionRows) {
        let meta: any = null; try { meta = q.metadata ? JSON.parse(q.metadata) : null; } catch {}
        if (meta?.groupMemberOf) continue; // skip member grading
        // Skip legacy container table question types (no direct grading; their referenced cell sub-questions are separate)
        if (q.question_type === 'table_fill_blank' || q.question_type === 'table_drag_drop') continue;
        // Handle new simple_table aggregated question: grade each embedded cell
        if (q.question_type === 'simple_table') {
          // Flatten each table cell (and each blank within multi-blank cells) into graded entries
          let meta: any = null; try { meta = q.metadata ? JSON.parse(q.metadata) : null; } catch {}
          const rawStudent = answerMap[q.id];
          let studentObj: any = null; try { studentObj = typeof rawStudent === 'string' ? JSON.parse(rawStudent) : rawStudent; } catch {}
          const rows = meta?.simpleTable?.rows || [];
          const gradedEntries: any[] = [];
          let tableScore = 0;
          let tableMax = 0;
          const norm = normalize;
          rows.forEach((row: any[], ri: number) => row.forEach((cell: any, ci: number) => {
            if (!cell || cell.type !== 'question') return;
            const baseKey = `${ri}_${ci}`;
            const qType = cell.questionType || 'fill_blank';
            const pts = parseFloat(cell.points || 1);
            const correctAnswerRaw: string = cell.correctAnswer || '';
            const studentValRaw = studentObj?.cells?.[baseKey];
            // Determine blank groups (for multi blank semantics). Use maximum of: multiNumbers length, student array length, answer groups length.
            const groups = correctAnswerRaw.includes(';') ? correctAnswerRaw.split(';') : [correctAnswerRaw];
            const multiNums: number[] = Array.isArray(cell.multiNumbers) ? cell.multiNumbers.filter((n: any) => Number.isInteger(n)) : [];
            const studentArrLen = Array.isArray(studentValRaw) ? studentValRaw.length : 0;
            let blankCount = Math.max(
              multiNums.length > 1 ? multiNums.length : (multiNums.length === 1 ? 1 : 0),
              studentArrLen,
              groups.length > 1 ? groups.length : 1,
              1
            );
            if (blankCount < 1) blankCount = 1; // safety
            const baseNumber = (cell.questionNumber !== undefined ? cell.questionNumber : (multiNums[0] !== undefined ? multiNums[0] : undefined));
            // Scoring rule: each blank is worth the cell's point value (IELTS style 1 mark per blank). If author configured pts>1, we still treat it per blank.
            const perBlank = pts;
            // If student provided a single string for multiple blanks, attempt to split into tokens (semicolon > comma > whitespace)
            let studentArray: any[] | null = null;
            if (Array.isArray(studentValRaw)) studentArray = studentValRaw;
            else if (blankCount > 1 && typeof studentValRaw === 'string') {
              const attempts = [
                studentValRaw.split(';'),
                studentValRaw.split(','),
                studentValRaw.split(/\s+/)
              ].map(arr => arr.map(s => (s||'').trim()).filter(Boolean));
              for (const tokens of attempts) { if (tokens.length === blankCount) { studentArray = tokens; break; } }
            }
            for (let bi = 0; bi < blankCount; bi++) {
              const groupRaw = groups[bi] || groups[0] || '';
              let variants = groupRaw.split('|').map((s: string) => norm(s)).filter(Boolean);
              if (!variants.length && groupRaw) variants = [norm(groupRaw)];
              const studentValue = studentArray ? studentArray[bi] : (blankCount === 1 ? studentValRaw : undefined);
              const studentNorm = norm(studentValue);
              let isCorrect = false;
              if (qType === 'multiple_choice') {
                const got = studentNorm ? studentNorm.split('|').filter(Boolean) : [];
                const uniq = (arr: string[]) => Array.from(new Set(arr));
                const eU = uniq(variants); const gU = uniq(got);
                isCorrect = eU.length === gU.length && eU.every(v => gU.includes(v));
              } else if (qType === 'true_false') {
                const mapTF: Record<string, string> = { t: 'true', f: 'false', ng: 'not given', notgiven: 'not given' };
                const exp = mapTF[variants[0]] || variants[0];
                const rec = mapTF[studentNorm] || studentNorm;
                isCorrect = !!exp && exp === rec;
              } else { // fill_blank / short_answer
                const numMode = variants.length > 0 && variants.every(v => /^[-+]?(\d+\.?\d*|\.\d+)$/.test(v));
                const recNum = Number(studentNorm);
                if (variants.some(v => v === studentNorm || (numMode && !isNaN(recNum) && Number(v) === recNum))) isCorrect = true;
              }
              if (isCorrect) tableScore += perBlank;
              tableMax += perBlank;
              gradedEntries.push({
                key: blankCount > 1 ? `${baseKey}_b${bi}` : baseKey,
                baseKey,
                questionType: qType,
                questionNumber: (multiNums[bi] !== undefined)
                  ? multiNums[bi]
                  : (baseNumber !== undefined ? (blankCount > 1 ? (baseNumber + bi) : baseNumber) : undefined),
                studentAnswer: studentValue ?? null,
                correctAnswer: groupRaw || null,
                points: perBlank,
                isCorrect
              });
            }
          }));
          maxPossibleScore += tableMax;
            totalScore += tableScore;
          await query(`INSERT INTO exam_session_answers (session_id, question_id, student_answer, answered_at, is_correct, points_earned)
            VALUES ($1,$2,$3,CURRENT_TIMESTAMP,$4,$5)
            ON CONFLICT (session_id, question_id)
            DO UPDATE SET student_answer = EXCLUDED.student_answer, answered_at = CURRENT_TIMESTAMP, is_correct = EXCLUDED.is_correct, points_earned = EXCLUDED.points_earned`, [
              sessionId,
              q.id,
              JSON.stringify({ ...(studentObj || {}), type: 'simple_table', version: 2, graded: gradedEntries }),
              tableScore >= tableMax && tableMax > 0,
              tableScore
            ]);
          continue;
        }
        const studentAnswer = answerMap[q.id];
        if (studentAnswer === undefined) continue;
        maxPossibleScore += parseFloat(q.points);
        await query(`INSERT INTO exam_session_answers (session_id, question_id, student_answer, answered_at)
          VALUES ($1,$2,$3,CURRENT_TIMESTAMP)
          ON CONFLICT (session_id, question_id)
          DO UPDATE SET student_answer = EXCLUDED.student_answer, answered_at = CURRENT_TIMESTAMP`, [sessionId, q.id, JSON.stringify(studentAnswer)]);
        const expected = q.correct_answer ? normalize(q.correct_answer) : '';
        let received = normalize(studentAnswer);
        let isCorrect = false;
  if (q.question_type === 'multiple_choice' || q.question_type === 'matching' || q.question_type === 'drag_drop') {
          if (q.question_type === 'matching' && received && /^[a-z]$/.test(received)) {
            try {
              const bank = q.heading_bank ? JSON.parse(q.heading_bank) : null;
              const options = Array.isArray(bank?.options) ? bank.options : [];
              const idx = received.charCodeAt(0) - 97;
              const mapped = options[idx]?.letter ? normalize(options[idx].letter) : '';
              if (mapped) received = mapped;
            } catch {}
          }
          if (q.question_type === 'multiple_choice' && q.correct_answer && q.correct_answer.includes('|')) {
            const expectedSet = Array.from(new Set(q.correct_answer.split('|').map((p:string)=>normalize(p))));
            let studentSet: string[] = [];
            if (Array.isArray(studentAnswer)) studentSet = (studentAnswer as any[]).map(v=>normalize(v));
            else if (typeof studentAnswer === 'string') studentSet = studentAnswer.split('|').map((p:string)=>normalize(p));
            studentSet = Array.from(new Set(studentSet));
            if (expectedSet.length === studentSet.length && (expectedSet as string[]).every((v: string) => studentSet.includes(v))) isCorrect = true;
          } else {
            isCorrect = expected !== '' && received === expected;
          }
        } else if (q.question_type === 'multi_select') {
          let expectedSet: string[] = [];
          try { if (q.correct_answer && q.correct_answer.trim().startsWith('[')) { const arr = JSON.parse(q.correct_answer); if (Array.isArray(arr)) expectedSet = arr.map((x:any)=>normalize(x)); } } catch {}
          if (expectedSet.length === 0 && q.correct_answer) expectedSet = q.correct_answer.split('|').map((p:string)=>normalize(p));
          let studentSet: string[] = [];
          if (Array.isArray(studentAnswer)) studentSet = (studentAnswer as any[]).map(v=>normalize(v));
          else if (typeof studentAnswer === 'string') studentSet = studentAnswer.split('|').map(p=>normalize(p));
          expectedSet = Array.from(new Set(expectedSet));
          studentSet = Array.from(new Set(studentSet));
          if (expectedSet.length === studentSet.length && expectedSet.every(v => studentSet.includes(v))) isCorrect = true;
        } else if (q.question_type === 'true_false') {
          const mapTF: Record<string,string> = { 't':'true','f':'false','ng':'not given','notgiven':'not given' };
          const rec = mapTF[received] || received; const exp = mapTF[expected] || expected; isCorrect = exp !== '' && rec === exp;
  } else if (q.question_type === 'fill_blank') {
          let accepted: string[] = [];
            try { if (q.correct_answer && q.correct_answer.trim().startsWith('[')) { const arr = JSON.parse(q.correct_answer); if (Array.isArray(arr)) accepted = arr.map((a:any)=>normalize(a)); } } catch {}
            if (accepted.length === 0 && q.correct_answer) accepted = q.correct_answer.split('|').map((p:string)=>normalize(p));
            if (accepted.length === 0 && expected) accepted = [expected];
            const recNum = Number(received);
            const numericMode = accepted.every(a=>/^[-+]?(\d+\.?\d*|\.\d+)$/.test(a));
            if (Array.isArray(studentAnswer)) {
              if (q.correct_answer && q.correct_answer.includes(';')) {
                const groupsRaw: string[] = q.correct_answer.split(';');
                const groupAccepts: string[][] = groupsRaw.map((g:string)=>g.split('|').map((a:string)=>normalize(a.trim())).filter(Boolean));
                isCorrect = (studentAnswer as any[]).every((ans, idx)=>{
                  const recv = normalize(ans); const gAcc = groupAccepts[idx]||[]; if (!gAcc.length) return false; const num = Number(recv); const localNumeric = gAcc.every(a=>/^[-+]?(\d+\.?\d*|\.\d+)$/.test(a)); return gAcc.some(a=>a===recv || (localNumeric && !isNaN(num) && Number(a)===num));
                }) && (studentAnswer as any[]).length === groupAccepts.length;
              } else {
                let parsedCorrect: any = null; try { parsedCorrect = q.correct_answer ? JSON.parse(q.correct_answer) : null; } catch {}
                isCorrect = (studentAnswer as any[]).every((ans, idx)=>{
                  const recv = normalize(ans); let localAccepted = accepted; if (Array.isArray(parsedCorrect) && Array.isArray(parsedCorrect[idx])) localAccepted = parsedCorrect[idx].map((x:any)=>normalize(x)); const num = Number(recv); const localNumeric = localAccepted.every(a=>/^[-+]?(\d+\.?\d*|\.\d+)$/.test(a)); return localAccepted.some(a=>a===recv || (localNumeric && !isNaN(num) && Number(a)===num));
                });
              }
            } else {
              isCorrect = accepted.some(a=>a===received || (numericMode && !isNaN(recNum) && Number(a)===recNum));
            }
        } else if (q.question_type === 'short_answer') {
          // Accepted answers can be in correct_answer separated by | or metadata.acceptedAnswers array
          let accepted: string[] = [];
          try { if (q.metadata) { const meta = typeof q.metadata === 'string' ? JSON.parse(q.metadata) : q.metadata; if (Array.isArray(meta?.acceptedAnswers)) accepted = meta.acceptedAnswers.map((a:any)=>normalize(String(a))); } } catch {}
          if (accepted.length === 0 && q.correct_answer) accepted = q.correct_answer.split('|').map((p:string)=>normalize(p));
          const cleaned = received.replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
          // enforce 1-3 words, else mark incorrect automatically
          const words = cleaned ? cleaned.split(' ') : [];
            if (words.length >=1 && words.length <=3) {
              isCorrect = accepted.some(a=>a===cleaned);
            }
        } else if (q.question_type === 'writing_task1' || q.question_type === 'essay') {
          // Free-response, skip auto grading (leave false so points_earned 0). Could be manually graded later.
        } else if (q.question_type === 'image_labeling') {
          // Per-question credit: compare student's text with correct_answer (case/space-insensitive)
          const norm = (s:string) => s.replace(/\s+/g,' ').trim().toLowerCase();
          if (q.correct_answer) {
            const expected = norm(String(q.correct_answer));
            const got = norm(String(received||''));
            isCorrect = expected.length>0 && got === expected;
          } else {
            isCorrect = false;
          }
        } else if (q.question_type === 'image_dnd') {
          // Expect JSON: { placements: { [anchorId:string]: token:string } }
          // Correct mapping provided in metadata.correctMap
          let correctCount = 0; let max = 0;
          try {
            const meta = q.metadata ? (typeof q.metadata === 'string' ? JSON.parse(q.metadata) : q.metadata) : {};
            const correct = meta?.correctMap || {};
            const student = JSON.parse(received || '{}');
            const placements = student?.placements || {};
            for (const aid of Object.keys(correct)) { max += 1; if (placements[aid] && String(placements[aid]) === String(correct[aid])) correctCount += 1; }
            // Consider correct only if all matched; partial scoring can be added later
            isCorrect = (max > 0 && correctCount === max);
          } catch { isCorrect = false; }
        }
        if (isCorrect) {
          totalScore += parseFloat(q.points);
          await query(`UPDATE exam_session_answers SET is_correct = true, points_earned = $1 WHERE session_id = $2 AND question_id = $3`, [q.points, sessionId, q.id]);
        } else {
          await query(`UPDATE exam_session_answers SET is_correct = false, points_earned = 0 WHERE session_id = $1 AND question_id = $2`, [sessionId, q.id]);
        }
      }
      // Propagate anchor correctness to members
      for (const anchorId of Object.keys(anchors)) {
        const group = anchors[anchorId]; if (!group.anchor || !group.members.length) continue;
        const r = await query('SELECT is_correct, points_earned FROM exam_session_answers WHERE session_id = $1 AND question_id = $2', [sessionId, anchorId]);
        if (r.rowCount === 0) continue; const { is_correct } = r.rows[0];
        for (const m of group.members) {
          // ensure answer row exists (even if user didn't send it) using student's anchor answer value
          if (!answerMap[m.id]) {
            await query(`INSERT INTO exam_session_answers (session_id, question_id, student_answer, answered_at, is_correct, points_earned)
              VALUES ($1,$2,$3,CURRENT_TIMESTAMP,$4,$5)
              ON CONFLICT (session_id, question_id) DO UPDATE SET is_correct = EXCLUDED.is_correct, points_earned = EXCLUDED.points_earned, answered_at = CURRENT_TIMESTAMP`, [sessionId, m.id, 'null', is_correct, is_correct ? m.points : 0]);
          } else {
            await query(`UPDATE exam_session_answers SET is_correct = $1, points_earned = $2 WHERE session_id = $3 AND question_id = $4`, [is_correct, is_correct ? m.points : 0, sessionId, m.id]);
          }
          if (is_correct) totalScore += parseFloat(m.points);
          maxPossibleScore += parseFloat(m.points); // include member points in possible score
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

// GET /api/exams/sessions/:sessionId/answers - Fetch saved answers so far (autosave retrieval)
router.get('/sessions/:sessionId/answers', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const r = await query(`
    SELECT esa.question_id, esa.student_answer, eq.question_number
    FROM exam_session_answers esa
    JOIN exam_questions eq ON eq.id = esa.question_id
    WHERE esa.session_id = $1
  `, [sessionId]);
  const answers: Record<string, any> = {};
  r.rows.forEach((row: any) => {
    let parsed: any = null; try { parsed = JSON.parse(row.student_answer || 'null'); } catch { parsed = row.student_answer; }
    answers[row.question_id] = { questionId: row.question_id, answer: parsed, questionNumber: row.question_number };
  });
  res.json({ success: true, data: { answers } });
}));

// POST /api/exams/sessions/:sessionId/answers - Incremental autosave for answers
router.post('/sessions/:sessionId/answers', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const { answers } = req.body as { answers: Array<{ questionId: string; answer: any }> };
  if (!Array.isArray(answers) || answers.length === 0) { res.json({ success: true, message: 'No changes' }); return; }
  // Ensure session is active (pending/in_progress/expired allowed; block submitted)
  const s = await query('SELECT id, status FROM exam_sessions WHERE id = $1', [sessionId]);
  if (s.rowCount === 0) throw createNotFoundError('Exam session');
  if (s.rows[0].status === 'submitted') throw new AppError('Session already submitted', 400);
  for (const a of answers) {
    await query(`
      INSERT INTO exam_session_answers (session_id, question_id, student_answer, answered_at)
      VALUES ($1,$2,$3,CURRENT_TIMESTAMP)
      ON CONFLICT (session_id, question_id)
      DO UPDATE SET student_answer = EXCLUDED.student_answer, answered_at = CURRENT_TIMESTAMP
    `, [sessionId, a.questionId, JSON.stringify(a.answer)]);
  }
  res.json({ success: true, message: 'Answers saved' });
}));

// GET /api/exams/results/:ticketCode - Public endpoint for ticket-based result check
router.get('/results/:ticketCode',
  asyncHandler(async (req: Request, res: Response) => {
    const { ticketCode } = req.params;
    const sess = await query(`
      SELECT es.id, es.status, es.submitted_at, es.is_approved, es.total_score, es.percentage_score,
             e.title as exam_title, e.duration_minutes, e.exam_type
      FROM exam_sessions es
      JOIN tickets t ON es.ticket_id = t.id
      JOIN exams e ON es.exam_id = e.id
      WHERE t.ticket_code = $1
      ORDER BY es.submitted_at DESC NULLS LAST
      LIMIT 1
    `, [ticketCode.toUpperCase()]);
    if (sess.rowCount === 0) {
      return res.json({ success: true, data: { status: 'not_found' } });
    }
    const s = sess.rows[0];
    let state: 'pending'|'submitted'|'approved' = 'pending';
    if (s.status === 'submitted') state = s.is_approved ? 'approved' : 'submitted';

    // Calculate per-section correct counts for reading/listening
    let readingCorrect = 0; let readingTotal = 0;
    let listeningCorrect = 0; let listeningTotal = 0;
    try {
      const counts = await query(`
        SELECT esec.section_type, COUNT(*) AS total, SUM(CASE WHEN COALESCE(esa.is_correct,false) THEN 1 ELSE 0 END) AS correct
        FROM exam_session_answers esa
        JOIN exam_questions eq ON eq.id = esa.question_id
        JOIN exam_sections esec ON esec.id = eq.section_id
        WHERE esa.session_id = $1
        GROUP BY esec.section_type
      `, [s.id]);
      for (const r of counts.rows) {
        if (r.section_type === 'reading') { readingTotal = Number(r.total||0); readingCorrect = Number(r.correct||0); }
        if (r.section_type === 'listening') { listeningTotal = Number(r.total||0); listeningCorrect = Number(r.correct||0); }
      }
    } catch {}

    // Band calculators (IELTS style)
    const listeningBandFromCorrect = (c: number): number => {
      if (c >= 39) return 9.0; if (c >= 37) return 8.5; if (c >= 35) return 8.0; if (c >= 32) return 7.5; if (c >= 30) return 7.0;
      if (c >= 26) return 6.5; if (c >= 23) return 6.0; if (c >= 18) return 5.5; if (c >= 16) return 5.0; if (c >= 13) return 4.5;
      if (c >= 10) return 4.0; if (c >= 7) return 3.5; if (c >= 5) return 3.0; if (c >= 3) return 2.5; return 2.0;
    };
    const readingBandFromCorrect = (c: number, examType?: string): number => {
      const acad = examType === 'academic';
      if (acad) {
        if (c >= 39) return 9.0; if (c >= 37) return 8.5; if (c >= 35) return 8.0; if (c >= 33) return 7.5; if (c >= 30) return 7.0;
        if (c >= 27) return 6.5; if (c >= 23) return 6.0; if (c >= 19) return 5.5; if (c >= 15) return 5.0; if (c >= 13) return 4.5;
        if (c >= 10) return 4.0; if (c >= 8) return 3.5; if (c >= 6) return 3.0; if (c >= 4) return 2.5; return 2.0;
      } else {
        if (c >= 40) return 9.0; if (c >= 39) return 8.5; if (c >= 37) return 8.0; if (c >= 36) return 7.5; if (c >= 34) return 7.0;
        if (c >= 32) return 6.5; if (c >= 30) return 6.0; if (c >= 27) return 5.5; if (c >= 23) return 5.0; if (c >= 19) return 4.5;
        if (c >= 15) return 4.0; if (c >= 12) return 3.5; if (c >= 9) return 3.0; if (c >= 6) return 2.5; return 2.0;
      }
    };

    const readingBand = readingTotal > 0 ? readingBandFromCorrect(readingCorrect, s.exam_type) : undefined;
    const listeningBand = listeningTotal > 0 ? listeningBandFromCorrect(listeningCorrect) : undefined;

    // Include writing feedback (teacher comments) when the session has been graded/approved
    let writingFeedback: any[] | undefined = undefined;
    if (state === 'approved') {
      const wr = await query(`
        SELECT eq.question_type, eq.question_text, esa.points_earned, esa.grader_comments
        FROM exam_session_answers esa
        JOIN exam_questions eq ON eq.id = esa.question_id
        JOIN exam_sections esec ON esec.id = eq.section_id
        WHERE esa.session_id = $1 AND esec.section_type = 'writing'
        ORDER BY eq.question_type
      `, [s.id]);
      writingFeedback = wr.rows.map((r: any) => ({
        type: r.question_type,
        questionText: r.question_text,
        band: r.points_earned,
        comments: r.grader_comments
      }));
    }
    res.json({ success: true, data: {
      ticketCode: ticketCode.toUpperCase(),
      status: state,
      examTitle: s.exam_title,
      submittedAt: s.submitted_at,
      // keep totals for admin/debug, but clients shouldn't show percentage
      totalScore: s.total_score,
      percentageScore: s.percentage_score,
      // new fields for public display
      examType: s.exam_type,
      readingCorrect,
      readingTotal,
      listeningCorrect,
      listeningTotal,
      readingBand,
      listeningBand,
      writingFeedback
    }});
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