# Atrium Current State (Handoff)

Last updated: 2026-02-15

## Current Status

- App is implemented end-to-end (frontend + backend + Redis sessions + S3 flows).
- Sentry integration is in place for frontend and backend.
- TypeScript typecheck is currently passing.

## Important Implementation Decisions

- Architecture uses Vite + React + Fastify (not TanStack Start) to keep runtime and deployment simple.
- S3 provider settings are backend env-controlled only.
- Session auth uses secure cookie token + Redis credential mapping.
- Backend Sentry init uses ESM preload module (`--import`) before server startup.
- Metrics use direct `Sentry.metrics.*` calls.

## Key Entrypoints

- Frontend entry: `src/app/main.tsx`
- Backend entry: `src/server/index.ts`
- Backend preload: `src/server/sentry.server.ts`
- Observability hooks: `src/server/observability.ts`

## Recommended Next Checks

1. Run app locally and validate telemetry in Sentry UI.
2. Confirm dashboards/alerts use current metric names.
3. Run `pnpm build` for production artifact confirmation.
