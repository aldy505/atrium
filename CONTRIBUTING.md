# Contributing to Atrium

Thanks for your interest in contributing.

This project is a TypeScript monorepo-style app with:

- Frontend: React + Vite (`src/app`, `src/components`)
- Backend: Fastify (`src/server`)
- Session/auth: secure cookie + Redis token mapping
- Object storage: S3-compatible providers (MinIO for local development)

## Prerequisites

- Node.js 20+
- `pnpm` (required)
- Docker + Docker Compose (recommended for local MinIO/Redis)

## Getting Started

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Copy environment variables:

   ```bash
   cp .env.example .env
   ```

3. Start local infra + app (recommended):

   ```bash
   docker-compose up --build
   ```

   Or run app in dev mode locally:

   ```bash
   pnpm dev
   ```

## Project Structure

- `src/app`: frontend app entry and app-level logic
- `src/components`: reusable UI components
- `src/server`: Fastify API, auth/session, S3 integration, observability
- `.agents/docs`: implementation history and handoff context

## Development Workflow

1. Create a branch from `master`.
2. Keep changes focused and small.
3. Prefer root-cause fixes over surface patches.
4. Update docs when behavior/config changes.

## Quality Checks

Before opening a PR, run:

```bash
pnpm typecheck
pnpm build
pnpm run lint
```

Formatting workflow (`package.json` scripts):

- `pnpm run fmt` → applies formatting changes.
- `pnpm run fmt:check` → checks formatting without modifying files.

If formatting changes are needed, run:

```bash
pnpm run fmt
```

## Coding Guidelines

- Use strict TypeScript patterns already present in the codebase.
- Keep API routes under `/api/*`.
- Do not add provider endpoint/region controls to UI (backend env only).
- Avoid introducing unrelated refactors in feature/fix PRs.
- Preserve existing architecture (React app + Fastify backend) unless discussed first.

## Testing Notes

- Validate both frontend and backend flows for feature changes.
- For S3-related changes, verify against local MinIO when possible.
- For auth/session changes, verify login/logout/session expiry behavior.

## Observability Notes

- Backend Sentry is initialized via preload module in production start.
- Frontend Sentry runtime config is fetched from `/api/runtime-config`.
- If adding/changing metrics, document metric names in `README.md`.

## Pull Request Guidelines

Please include in your PR description:

- What changed
- Why it changed
- How to test it
- Any env/config updates
- Screenshots for UI changes (if applicable)

Keep PRs reviewable; split large changes into multiple PRs when possible.

## Commit Messages

Use clear, concise commit messages (Conventional Commit style preferred), e.g.:

- `feat: add object pagination for large buckets`
- `fix: handle missing runtime sentry config gracefully`
- `docs: update setup and observability notes`

## Security & Secrets

- Never commit credentials, tokens, or `.env` files.
- Treat access keys and session identifiers as sensitive.
- Redact sensitive values in logs and issue reports.

## Questions

If you are unsure about approach or scope, open a draft PR early and ask for feedback before deep implementation.
