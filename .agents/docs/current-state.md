# Atrium Current State (Handoff)

Last updated: 2026-03-15

## Current Status

- App is implemented end-to-end (frontend + backend + Redis sessions + S3 flows).
- Cursor pagination for object listing is implemented across API + UI.
- Redis-backed server-side S3 list cache is implemented for `/api/s3/objects`.
- UI supports both manual pagination (**Load more**) and optional auto-load on scroll.
- Object table rendering is virtualized with `@tanstack/react-virtual` for large folders.
- Frontend page loading is adaptive (`100` initial, then `250` → `500` → `1000`).
- Scroll position is restored per bucket/prefix when navigating back.
- Search input is debounced (`300ms`) and warns when large-folder searches are limited to loaded items.
- Bucket-size API is consumed by UI for large-folder warning prompts (`Load first 1,000` vs `Load all`).
- Sorting behavior is tiered by loaded object count with S3-native name ordering as default for large sets.
- UI supports creating folders with validation and navigation on success.
- Frontend Sentry is initialized at runtime via `/api/runtime-config`; settings come from `FRONTEND_SENTRY_*` environment variables.
- Runtime feature flags are exposed via `/api/runtime-config`.
- `ENABLE_S3_URI_COPY` now gates a sidebar **Copy S3 URI** action for file previews (disabled by default).
- Right preview sidebar is collapsible and starts collapsed when no file is selected.
- Preview sidebar auto-opens on file selection and does not auto-open for folder interactions.
- PDF files now open in a top-level floating modal viewer powered by `pdfjs-viewer-element` / PDF.js, while metadata and tags remain in the right sidebar.
- The large PDF viewer is no longer rendered from the sidebar subtree, so it is not visually anchored to the preview column.
- Password-protected PDFs are handled on a best-effort basis via the embedded viewer; download remains available as a fallback.
- Browser favicon support is now wired through the Vite app shell with generated `svg`, `png`, and `ico` assets at the repo root.

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
7. Preview a multi-page PDF, verify the viewer opens as a page-wide modal, and confirm zoom/search/thumbs and download still work.
8. Open the app in a browser and confirm the generated favicon appears in the tab in both dev and production builds.
