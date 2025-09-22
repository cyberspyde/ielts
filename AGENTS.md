# Repository Guidelines

## Project Structure & Module Organization
- `client/` (Vite + React TS) organizes features in `pages/`, `components/`, and `services/`; shared assets live in `src/assets/` or `public/`.
- `server/` (Express + TS) keeps code under `config/`, `routes/`, `services/`, `middleware`, and `utils`; migrations sit in `server/migrations/`, and tests in `server/tests/`.
- Top-level SQL seeds, `.env` templates, runtime logs (`logs/`), and uploads (`server/uploads/`) support local setup.

## Build, Test, and Development Commands
- Install dependencies with `npm install` at the root, then inside `client/` and `server/`.
- `npm run dev` starts both apps via Concurrently; use `npm run server:dev` or `npm run client:dev` when isolating changes.
- `npm run build` triggers `client:build` and `server:build`; confirm `server/dist/` before deploy.
- `npm run test:server` runs Jest; `npm run test:client` is a placeholder until frontend tests exist. `npm run migrate` and `npm run seed` execute compiled scripts in `server/dist/scripts/`.

## Coding Style & Naming Conventions
- Use TypeScript with two-space indentation, trailing commas, and avoid `any` outside typed gateway shims.
- React components and pages use PascalCase filenames; hooks and utilities stay camelCase. Server functions stay camelCase; classes and DTOs use PascalCase.
- Run `npm run lint` in `client/` for the flat ESLint + React Hooks config. Server lint relies on TypeScript-ESLint defaults until a config is added. Keep shared Tailwind styling in `src/styles/`.

## Testing Guidelines
- API coverage sits in `server/tests/*.{test,e2e}.ts`; follow `exam-flow.e2e.test.ts` for integration flows and reuse `tests/setup.ts`.
- Name suites `Feature.behavior.test.ts` to keep reports grouped and track gaps in `server/tests/todo-tests`.
- Until UI automation exists, log manual scenarios, screenshots, or Cypress plans in each PR.

## Commit & Pull Request Guidelines
- Current history uses one-word subjects (`update`); switch to scoped, imperative messages like `feat(server-auth): issue JWT refresh token`, linking issues when possible.
- Before a PR, run `npm run build` and `npm run test:server`, summarize schema impacts, and attach UI evidence for visual changes.
- PR descriptions should list env keys touched, database impacts, follow-ups, and tag both frontend and backend reviewers for cross-surface work.

## Environment & Operations
- Copy `env.example` to `.env` at the root and in `server/`; fill PostgreSQL, Redis, and SMTP secrets before migrations.
- `startup.bat` boots app plus Redis; `startup-no-redis.bat` skips Redis for offline work.
- Keep `logs/`, `server/uploads/`, and credentials out of commits; verify `.gitignore` before adding new tooling.
