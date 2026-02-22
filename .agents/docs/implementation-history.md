# Atrium Implementation History

Last updated: 2026-02-17

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

## 10) 2026-02-15 Follow-up: Pagination, Runtime Sentry Config, and Metrics

- Implemented S3 object listing pagination end-to-end:
  - Backend `/api/s3/objects` now accepts `continuationToken` and `maxKeys`.
  - S3 listing in `src/server/s3.ts` returns `nextContinuationToken` and `isTruncated`.
  - Frontend switched to React Query `useInfiniteQuery` for paged loading.
- Added optional auto-loading via `IntersectionObserver` with manual **Load more** fallback.
- Added large-dataset validation by generating and verifying `5000` objects in MinIO.

## 11) 2026-02-15 Follow-up: Runtime Frontend Sentry Configuration

- Added backend endpoint `GET /api/runtime-config` to expose safe frontend telemetry settings.
- Frontend Sentry bootstrap now fetches runtime config at startup before rendering the app.
- Runtime values are driven exclusively by `FRONTEND_SENTRY_*` environment variables.

## 12) 2026-02-15 Follow-up: Upstream S3/Auth Metrics

- Added shared metric helpers in `src/server/observability.ts` for count, gauge, distribution.
- Added S3 latency distributions using key pattern `s3.(operation).latency`:
  - `s3.list_buckets.latency`
  - `s3.list_objects_v2.latency`
  - `s3.put_object.latency`
  - `s3.get_object.latency`
  - `s3.delete_object.latency`
- Added S3 transfer activity gauges:
  - `s3.upload.files_in_flight`
  - `s3.download.files_in_flight`
- Added auth result gauges in auth/session paths:
  - `auth.success`
  - `auth.failure`

## 13) 2026-02-16 Follow-up: Redis Folder-List Cache (Issue #5)

- Implemented Redis-backed server-side cache for `GET /api/s3/objects`.
- Cache key shape is session-scoped and pagination-aware:
  - `sessionToken + bucket + prefix + continuationToken + maxKeys`
- Added cache configuration in server env parsing (`src/server/config.ts`):
  - `S3_LIST_CACHE_ENABLED` (default `true`)
  - `S3_LIST_CACHE_TTL_SECONDS` (default `300`)
  - `S3_LIST_CACHE_INVALIDATION_MODE` (`targeted` or `bucket`, default `targeted`)
  - `S3_LIST_CACHE_INCLUDE_HEADERS` (default `true`)
- Added cache operations in `src/server/session.ts`:
  - read/write cached list responses with TTL
  - invalidate by bucket
  - invalidate by targeted prefixes/ancestor chain
- Added cache hit/miss and lookup/store/invalidation instrumentation in `src/server/routes.ts` via existing Sentry metric helpers.
- Added optional response header `X-Atrium-S3-List-Cache` with values `HIT`, `MISS`, `BYPASS`.
- Wired invalidation after existing mutations:
  - upload (`POST /api/s3/upload`)
  - delete object (`DELETE /api/s3/object`)
  - delete prefix (`DELETE /api/s3/prefix`)
- Updated docs in `.env.example` and `README.md` for cache envs and behavior.

## 14) 2026-02-16 Follow-up: Audit Logging (Filesystem/Loki)

- Added audit logging abstraction with pluggable sinks:
  - Filesystem CSV append (daily `audit-log_YYYYMMDD.csv` files)
  - Loki push (`POST /loki/api/v1/push`)
- Implemented audit event emission for:
  - Auth/session lifecycle (`auth.login`, `auth.logout`, `auth.me`, `auth.session`)
  - All S3 routes (list, upload, download, preview, metadata, delete)
- Hashes access key IDs with SHA-256 before logging (no plaintext credentials).
- Added env configuration for audit logging and retention (`AUDIT_LOG_*`).

## 15) 2026-02-17 Follow-up: Create Folder UX (Issue #3)

- Added a toolbar action + modal for creating folders with validation.
- Added `/api/s3/folder` route with folder-name normalization and cache invalidation.
- Implemented S3 folder creation with trailing-slash objects and a `.folderPlaceholder` fallback.
- Added frontend API helper and modal styling updates.

## 16) 2026-02-22 Follow-up: Copy S3 URI Feature Flag (Issue #19)

- Added `ENABLE_S3_URI_COPY` feature flag exposure via `GET /api/runtime-config` using OpenFeature.
- Added frontend runtime-config API helper and consumed feature flags in `App`.
- Implemented `Copy S3 URI` behavior in `FilePreview`:
  - Uses `navigator.clipboard.writeText()` when available.
  - Falls back to `document.execCommand("copy")`.
  - Shows temporary `Copied!` confirmation.
- Added dedicated folder `Details` action in object table so folder metadata view can drive copy behavior.
- Added URI utilities in `src/app/lib/s3-uri.ts` and tests in `tests/s3-uri.test.ts`.
- Updated `.env.example` and `README.md` to document `ENABLE_S3_URI_COPY`.
