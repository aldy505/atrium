# Atrium Implementation History

Last updated: 2026-02-15

## 1) Project Initialization

- Bootstrapped a single-repo TypeScript app with:
  - Frontend: React + Vite (`src/app`, `src/components`)
  - Backend: Fastify (`src/server`)
  - Package manager: `pnpm`
- Added baseline project config:
  - `package.json`, `pnpm-lock.yaml`
  - `tsconfig.json`, `tsconfig.server.json`, `vite.config.ts`
  - `.env.example`, `.gitignore`, `Dockerfile`, `docker-compose.yml`
  - `README.md`

## 2) Core Product Features Implemented

- Authentication/session model:
  - Login with Access Key ID + Secret Access Key
  - Credentials validated against configured S3 provider on login
  - Server issues secure session token in httpOnly cookie
  - Session data stored in Redis with TTL + sliding expiration
- S3 object browser capabilities:
  - List buckets
  - List objects by prefix with folder-style navigation
  - Breadcrumb navigation for prefixes
  - Client-side filter/search in current directory listing
  - Upload files (drag/drop + picker) with progress feedback
  - Download files with content-disposition support
  - Preview image/text files
  - Delete single file
  - Delete folder prefix recursively

## 3) Backend Architecture and Files

- Environment and safety:
  - `src/server/config.ts` validates env with Zod
  - S3 endpoint/region/provider options are env-driven (not UI editable)
- Auth/session:
  - `src/server/auth.ts` (login/logout/me + `requireSession`)
  - `src/server/session.ts` (Redis token lifecycle)
- S3 operations:
  - `src/server/s3.ts` (bucket/object CRUD and listing)
  - `src/server/routes.ts` (`/api/s3/*` endpoints)
- Error handling:
  - `src/server/errors.ts` (`AppError`, normalization helper)
  - global Fastify error handler in `src/server/index.ts`

## 4) Frontend Architecture and Files

- App shell and data flow:
  - `src/app/main.tsx` bootstraps React Query + Sentry error boundary
  - `src/app/App.tsx` handles auth state, bucket/object state, actions
  - `src/app/lib/api.ts` API client and upload progress via XHR
  - `src/app/lib/types.ts` shared frontend API types
- UI components:
  - `src/components/LoginForm.tsx`
  - `src/components/Breadcrumbs.tsx`
  - `src/components/ObjectTable.tsx`
  - `src/components/UploadDropzone.tsx`
  - `src/components/FilePreview.tsx`
  - `src/components/ConfirmDialog.tsx`
  - `src/components/FileIcon.tsx`

## 5) Runtime/Infrastructure

- Local/containerized runtime:
  - `docker-compose.yml` provisions app + Redis + MinIO
  - `.env.example` includes app, S3, Redis, and Sentry settings
- Build/runtime scripts:
  - `pnpm dev` runs Vite + Fastify dev loop
  - `pnpm build` builds frontend and backend
  - `pnpm start` starts production server with Sentry preload

## 6) Observability (Sentry) Work Completed

- Backend:
  - Added Node Sentry initialization via ESM preload module:
    - `src/server/sentry.server.ts`
  - Updated dev/start scripts to use preload (`--import` path)
  - Added request/response observability hooks:
    - `src/server/observability.ts`
  - Added error capture path + metric emission in global error handler
- Frontend:
  - Added Sentry init in `src/app/sentry.ts`
  - Wrapped app in `Sentry.ErrorBoundary` in `src/app/main.tsx`
- Metrics API usage:
  - Refactored to direct `Sentry.metrics.*` calls
  - Removed local wrapper helpers for metric increments/distributions

## 7) Validation and Debugging Completed

- Resolved TypeScript/build issues encountered during implementation.
- Re-ran checks multiple times; latest reported status:
  - `pnpm typecheck` passes
- Runtime smoke tests were executed against local Redis/MinIO in prior steps:
  - login/session validation
  - bucket/object listing
  - upload/download/preview/delete paths

## 8) Documentation and Agent Context

- Added/maintained:
  - `AGENTS.md`
  - `CLAUDE.md`
  - `.agents/context-compression.md`
- This file and companion docs are intended for continuation without losing implementation context.

## 9) Open/Optional Follow-ups

- Optional final verification in Sentry project UI:
  - confirm backend error events, traces, logs, and metrics ingestion
  - confirm frontend events and traces ingestion
- Optional naming harmonization for HTTP metrics if dashboard queries require stricter consistency.
