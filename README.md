# Atrium

Atrium is a self-hosted web app for browsing and managing S3-compatible object storage.

## Features (v1)

- Login with Access Key ID + Secret Access Key (no user account system)
- Redis-backed secure session tokens with TTL and httpOnly cookie auth
- Provider-agnostic S3 support (AWS S3, Cloudflare R2, MinIO, Backblaze B2, DigitalOcean Spaces)
- Bucket and folder navigation with breadcrumbs
- File upload (drag/drop or picker) with progress indication
- File download with proper content-type and filename
- Delete file or folder prefix with confirmation dialogs
- File preview for:
  - Images: `jpg`, `jpeg`, `png`, `gif`, `webp`, `svg`
  - Text: `txt`, `md`, `json`, `xml`, `csv`, `log`
- Client-side filtering of current folder entries by name

## Architecture

This implementation uses a Vite + React frontend with a Fastify TypeScript backend in one repository. It is a deliberate alternative to TanStack Start for v1 to keep deployment and Docker runtime behavior straightforward while preserving SSR-ready migration paths.

- Frontend: React + TypeScript (dashboard in `src/app`, reusable UI in `src/components`)
- Backend: Node.js + Fastify + TypeScript (`src/server`)
- S3 operations: AWS SDK v3 (`@aws-sdk/client-s3`)
- Session store: Redis (`token -> credentials`, TTL)
- Deployment: Docker Compose (`atrium-app`, `redis`, `minio`)

## Quick Start (Local with Included MinIO)

1. Copy env template:

```bash
cp .env.example .env
```

2. Start all services:

```bash
docker-compose up --build
```

3. Open Atrium:

- App: http://localhost:3000
- MinIO API: http://localhost:9000
- MinIO Console: http://localhost:9001

4. Login to Atrium using MinIO test credentials:

- Access Key ID: `minioadmin`
- Secret Access Key: `minioadmin`

5. Create a bucket in MinIO Console first, then browse/upload/download/delete through Atrium.

## MinIO Test Credentials

- `MINIO_ROOT_USER=minioadmin`
- `MINIO_ROOT_PASSWORD=minioadmin`

You can change these in `.env`.

## Environment Variables

| Variable                         | Required   | Default          | Description                              |
| -------------------------------- | ---------- | ---------------- | ---------------------------------------- |
| `NODE_ENV`                       | no         | `development`    | Runtime environment                      |
| `PORT`                           | no         | `3000`           | API/web app port                         |
| `REDIS_URL`                      | yes        | -                | Redis connection URL                     |
| `SESSION_TTL_SECONDS`            | no         | `86400`          | Session TTL in seconds                   |
| `COOKIE_NAME`                    | no         | `atrium_session` | Session cookie name                      |
| `S3_ENDPOINT`                    | yes        | -                | S3-compatible endpoint URL               |
| `S3_REGION`                      | yes        | -                | S3 region string                         |
| `S3_FORCE_PATH_STYLE`            | no         | `true`           | Use path-style S3 URLs (needed by MinIO) |
| `MAX_UPLOAD_SIZE_MB`             | no         | `100`            | Per-file upload size limit               |
| `SENTRY_DSN`                     | no         | -                | Backend Sentry DSN                       |
| `SENTRY_ENVIRONMENT`             | no         | `development`    | Backend Sentry environment               |
| `SENTRY_RELEASE`                 | no         | `atrium@0.1.0`   | Backend release identifier               |
| `SENTRY_TRACES_SAMPLE_RATE`      | no         | `0.1`            | Backend tracing sample rate              |
| `SENTRY_ENABLE_LOGS`             | no         | `true`           | Enable backend Sentry logs               |
| `SENTRY_ENABLE_METRICS`          | no         | `true`           | Enable backend Sentry metrics            |
| `VITE_SENTRY_DSN`                | no         | -                | Frontend Sentry DSN                      |
| `VITE_SENTRY_ENVIRONMENT`        | no         | `development`    | Frontend Sentry environment              |
| `VITE_SENTRY_RELEASE`            | no         | `atrium@0.1.0`   | Frontend release identifier              |
| `VITE_SENTRY_TRACES_SAMPLE_RATE` | no         | `0.1`            | Frontend tracing sample rate             |
| `VITE_SENTRY_ENABLE_LOGS`        | no         | `true`           | Enable frontend Sentry logs              |
| `VITE_SENTRY_ENABLE_METRICS`     | no         | `true`           | Enable frontend Sentry metrics           |
| `MINIO_ROOT_USER`                | local only | `minioadmin`     | Local MinIO root access key              |
| `MINIO_ROOT_PASSWORD`            | local only | `minioadmin`     | Local MinIO root secret                  |

## Configure for Different Providers

Only backend env changes are needed. The UI always asks only for access key + secret key.

### AWS S3

```env
S3_ENDPOINT=https://s3.amazonaws.com
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=false
```

### Cloudflare R2

```env
S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_REGION=auto
S3_FORCE_PATH_STYLE=true
```

### Backblaze B2 (S3 Compatible)

```env
S3_ENDPOINT=https://s3.<REGION>.backblazeb2.com
S3_REGION=<REGION>
S3_FORCE_PATH_STYLE=true
```

### DigitalOcean Spaces

```env
S3_ENDPOINT=https://<REGION>.digitaloceanspaces.com
S3_REGION=<REGION>
S3_FORCE_PATH_STYLE=false
```

## Development

```bash
pnpm install
pnpm dev
```

- Vite dev server runs on `5173`
- API server runs on `3000`
- Vite proxies `/api` to backend

## Production Build

```bash
pnpm build
pnpm start
```

- Backend Sentry initializes via Node ESM preload (`--import ./dist/server/sentry.server.js`) before Fastify boot.

## Security Notes

- Credentials are never persisted in browser storage.
- Session cookie is `httpOnly`; `secure` is enabled automatically in production mode.
- Credentials are stored server-side in Redis under random high-entropy tokens with TTL.
- Sessions are isolated; each token maps to one credential pair.
- Endpoint and region are controlled by backend environment variables only.

## Open Source Notes

This repository is designed for self-hosting and extension. Future versions can add sharing links, batch operations, richer previews, and ACL tooling.
