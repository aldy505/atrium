# Atrium Current State (Handoff)

Last updated: 2026-02-22

## Current Status

- App is implemented end-to-end (frontend + backend + Redis sessions + S3 flows).
- Cursor pagination for object listing is implemented across API + UI.
- Redis-backed server-side S3 list cache is implemented for `/api/s3/objects`.
- UI supports both manual pagination (**Load more**) and optional auto-load on scroll.
- UI supports creating folders with validation and navigation on success.
  <<<<<<< HEAD
- Frontend Sentry is initialized at runtime via `/api/runtime-config`; settings come from `FRONTEND_SENTRY_*` environment variables.
- Runtime feature flags are exposed via `/api/runtime-config`.
- `ENABLE_S3_URI_COPY` now gates a sidebar **Copy S3 URI** action (disabled by default).
- Sidebar detail view now supports both file and folder selections.

- Backend S3/auth metric instrumentation is in place.
- Audit logging is in place with filesystem CSV or Loki sinks.
- TypeScript typecheck and production build are passing.

## Important Implementation Decisions

- Architecture uses Vite + React + Fastify (not TanStack Start) to keep runtime and deployment simple.
- S3 provider settings are backend env-controlled only.
- Session auth uses secure cookie token + Redis credential mapping.
- Backend Sentry init uses ESM preload module (`--import`) before server startup.
- Frontend Sentry config is runtime-resolved from backend (`FRONTEND_SENTRY_*` preferred).
- Optional frontend feature flags are runtime-resolved from backend/OpenFeature.
- Metrics use direct `Sentry.metrics.*` calls.
- S3 list API is paginated (`maxKeys`, continuation tokens), default page size `200`.
- Audit logs never store plaintext credentials; access key IDs are SHA-256 hashed.
- S3 list cache key includes session token + bucket + prefix + continuation token + `maxKeys`.
- Cache invalidation runs after upload/delete with env-selectable mode:
  - `targeted` (default): parent-prefix lineage (+ deleted subtree for prefix delete)
  - `bucket`: invalidate all cached pages for session+bucket
- Folder creation uses trailing-slash S3 objects with a placeholder fallback when needed.

## Key Entrypoints

- Frontend entry: `src/app/main.tsx`
- Backend entry: `src/server/index.ts`
- Backend preload: `src/server/sentry.server.ts`
- Observability hooks: `src/server/observability.ts`

## Recommended Next Checks

1. Run app and navigate very large buckets (5k+) with auto-load both on and off.
2. Validate Sentry ingestion for:
   - `s3.*.latency`
   - `s3.upload.files_in_flight`
   - `s3.download.files_in_flight`
   - `auth.success`, `auth.failure`
3. Confirm runtime frontend Sentry config values served by `/api/runtime-config` in target environment.
4. Verify list cache behavior headers for repeated folder navigation:
   - `X-Atrium-S3-List-Cache: MISS` on first request
   - `X-Atrium-S3-List-Cache: HIT` on repeated request
   - `X-Atrium-S3-List-Cache: BYPASS` when cache disabled or unavailable
5. Verify audit log output in filesystem or Loki based on `AUDIT_LOG_SINK`.
6. Create a folder and confirm navigation enters the new prefix.
