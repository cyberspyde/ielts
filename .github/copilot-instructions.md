# AI Coding Agent Instructions for IELTS Online Testing Platform

Concise, project-specific guidance to be productive quickly. Follow exactly; avoid generic boilerplate. Keep changes minimal & consistent with existing patterns.

## 1. Architecture & Data Flow
- Monorepo style: `client/` (React + Vite + TS) and `server/` (Express + TS, PostgreSQL). No ORM – direct SQL via `pg` (`query()` helper in `server/src/config/database-no-redis.ts`).
- Stateless HTTP API + WebSocket layer (`socket.io`) for real-time exam monitoring/session updates (`setupSocketHandlers` in `services/socketService.ts`).
- Authentication: JWT (access + refresh). Refresh tokens stored via in-memory session store (placeholder for Redis). Auth middleware always re-validates user against DB.
- Exam lifecycle: exams → sections → questions (+ options) → sessions → answers. Core logic concentrated in `routes/exams.ts` (creation not shown here, but retrieval, session start, submission, grading pipeline are there).
- Grading: Mixed automatic logic inside `POST /api/exams/sessions/:sessionId/submit`. Handles multiple question types, grouped/table questions, variant answers, multi-select semantics. Avoid duplicating this—extend in place when adding new types.

## 2. Key Conventions & Patterns
- Use `asyncHandler` wrapper for route handlers to centralize error propagation to `errorHandler`.
- Standard API response shape: `{ success: boolean, data?: ..., message?: string, error?: string }`. For 404/validation etc., `errorHandler` ensures consistent payload. Return early with exceptions (`AppError`).
- Authorization: prefer `authMiddleware` (required) vs `optionalAuth` (public endpoints that may tailor response if authenticated). Admin gating via `requireRole([...])` or helpers `requireAdmin`, `requireSuperAdmin`.
- SQL: Write parameterized queries; build dynamic WHERE clauses by incrementing `$paramIndex`. Follow existing exam listing example for pagination & filters.
- Naming: DB columns use snake_case; API/JSON responses map to camelCase (manually). Preserve existing field mapping style when adding properties.
- Logging: Use `logger` (winston) – `info` for lifecycle events (session start, submit), `warn` for recoverable anomalies, `error` for failures. Avoid `console.log`.
- Rate limiting: Global via `express-rate-limit` unless disabled; per-user custom limiter via `rateLimitByUser`. Reuse helper instead of ad hoc counters.

## 3. Adding/Modifying Backend Features
- Place business rules in `services/` if they’re reusable; otherwise keep tightly-coupled logic within the route module (pattern seen in `exams.ts`).
- When introducing a new question type: extend submission grading branch inside `routes/exams.ts` (search for `question_type` conditionals). Add minimal incremental logic; do not refactor everything unless necessary.
- For new tables: create a new sequential SQL migration in `server/migrations/` (`NNN_description.sql`). Keep pure SQL—no JS migration framework present. Update any test setup assumptions if truncation order matters (`tests/setup.ts`).
- Return shapes: Follow existing `examDetails` / `sessions` mapping; don’t leak raw DB column names.

## 4. Testing Workflow
- Jest config currently minimal (empty `jest.config.js`); tests live in `server/tests/`. `tests/setup.ts` dynamically creates/uses a test DB and applies SQL migrations manually. Maintain idempotent migrations.
- Before adding tests requiring new tables, ensure truncation list in `tests/setup.ts` includes them in proper dependency order.
- Mock tokens: Current helpers return placeholder strings; if adding auth-sensitive tests, either: (a) implement lightweight JWT signing with `JWT_SECRET` from env, or (b) adjust test helpers to generate real tokens validated by `authMiddleware`.

## 5. Real-Time (Socket.io) Conventions
- Authenticate socket with `authenticate` event sending `{ token }` (same JWT). On success, client emits `join_exam` with `examId` + `sessionId` to enter room pattern: `exam:{examId}:{sessionId}`.
- Administrative monitoring rooms: `admin:exam:{sessionId}`. When adding broadcast events, respect these room naming conventions.
- Active sessions tracked in-memory (`activeSessions` Map). Don’t store large payloads there—only identifiers/state pointers.

## 6. Security & Validation
- Always run user input through `express-validator` or explicit whitelisting. Use `checkValidationErrors` pattern from `exams.ts`.
- Never trust client-provided role / IDs; fetch authoritative user/session rows before mutating.
- Multi-attempt logic: Currently unlimited sessions for an exam (design decision: comment notes removal). Preserve unless a new requirement explicitly reintroduces limits.

## 7. Performance & Reliability Notes
- In-memory session + rate limiting is a stand-in for Redis; code written to be easily swappable. Do not introduce Redis-specific APIs directly—abstract via existing helpers.
- Large answer submissions: Grading loop normalizes/JSON parses `metadata`; guard new logic with try/catch and log `warn` instead of failing whole submission.
- Avoid N+1 expansions unless needed (questions/options retrieval already grouped per section). When adding new relational data, prefer joining within existing exam fetch queries.

## 8. Frontend Integration Touchpoints
- Client expects audio files under `/uploads/*.mp3` with proper `Content-Type`. When adjusting static serving, keep header logic in `index.ts`.
- Pagination object shape (`{ currentPage, totalPages, totalCount, hasNext, hasPrev }`) should remain stable.
- Admin visibility of `correctAnswer`: only returned when `req.user.role` is admin/super_admin. Maintain this conditional.

## 9. Environment / Scripts
- Dev start backend: `npm run dev` in `server/` (tsx watch). Build with `npm run build` then `npm start` (runs `dist/index.js`).
- Migrations & seeds executed post-build (`dist/scripts/*.js`). Remember to rebuild before running `npm run migrate` / `seed` if you changed TypeScript.
- Config via `.env` (see `env.example` / `server` presence). Critical: `JWT_SECRET`, DB creds, optional `DISABLE_GLOBAL_RATE_LIMIT=1` during load tests.

## 10. How to Extend Safely
- Identify insertion point with semantic search (e.g., search existing `question_type` or route path). Mimic localized style.
- Prefer small, surgical edits; avoid broad refactors unless addressing a concrete bug/perf issue.
- Update docs inline as comments when behavior diverges (example: comments noting deprecated per-section duration).

Provide PRs that: (1) add migration (if schema change), (2) adapt truncation list in tests, (3) add/adjust grading logic, (4) include minimal test exercising new path.

---
If any area needs more depth (e.g., grading edge cases, token refresh flow, frontend conventions), request clarification before large changes.
