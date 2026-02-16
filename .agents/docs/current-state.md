# Atrium Current State (Handoff)

Last updated: 2026-02-16

## Current Status

- App is implemented end-to-end (frontend + backend + Redis sessions + S3 flows).
- Cursor pagination for object listing is implemented across API + UI.
- UI supports both manual pagination (**Load more**) and optional auto-load on scroll.
- Frontend Sentry is initialized at runtime via `/api/runtime-config` (with Vite env fallback).
- Backend S3/auth metric instrumentation is in place.
- Audit logging is in place with filesystem CSV or Loki sinks.
- TypeScript typecheck and production build are passing.

## Important Implementation Decisions

- Architecture uses Vite + React + Fastify (not TanStack Start) to keep runtime and deployment simple.
- S3 provider settings are backend env-controlled only.
- Session auth uses secure cookie token + Redis credential mapping.
- Backend Sentry init uses ESM preload module (`--import`) before server startup.
- Frontend Sentry config is runtime-resolved from backend (`FRONTEND_SENTRY_*` preferred).
- Metrics use direct `Sentry.metrics.*` calls.
- S3 list API is paginated (`maxKeys`, continuation tokens), default page size `200`.
- Audit logs never store plaintext credentials; access key IDs are SHA-256 hashed.

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
4. Verify audit log output in filesystem or Loki based on `AUDIT_LOG_SINK`.
