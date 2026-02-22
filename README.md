# Atrium

Atrium is a self-hosted web app for browsing and managing S3-compatible object storage.

> [!NOTE]
> Hello! Human here. This project is vibe-coded with various AI models (you will
> see Claude Sonnet 4.5, OpenAI GPT-5.3 Codex, and some other) during a long
> weekend. I was trying what is it to really one-shot a software that I actually
> need in real life, not just some janky project with AI slop in it.
>
> Turns out, it actually works and by the time you read this, I probably have
> this application running on my company.
>
> My specific use case is that I'm moving away from MinIO to SeaweedFS because
> of the drama and no-more-support, obviously. SeaweedFS does not provide a web
> UI similar to MinIO did. In my company I have a really weird process that
> needs the UI. Therefore, I really need one. Other solutions such as
> S3 Browser and Cyberduck are not viable for me, because it's a freemium, not
> fully open source.

## Features

- Login with Access Key ID + Secret Access Key (no user account system)
- Redis-backed secure session tokens with TTL and httpOnly cookie auth
- Provider-agnostic S3 support (AWS S3, Cloudflare R2, MinIO, ...you name it)
- Bucket and folder navigation with breadcrumbs
- File upload (drag/drop or picker) with progress indication
- File download with proper content-type and filename
- Delete file or folder prefix with confirmation dialogs
- File preview for:
  - Images: `jpg`, `jpeg`, `png`, `gif`, `webp`, `svg`
  - Text: `txt`, `md`, `json`, `xml`, `csv`, `log`
- Client-side filtering of current folder entries by name

## Architecture

This implementation uses a Vite + React frontend with a Fastify backend
in one repository.

- Frontend: React + TypeScript (dashboard in `src/app`, reusable UI in `src/components`)
- Backend: Node.js + Fastify + TypeScript (`src/server`)
- S3 operations: AWS SDK v3 (`@aws-sdk/client-s3`)
- Session store: Redis (`token -> credentials`, TTL)
- Deployment: Docker Compose (`atrium-app`, `redis`, `minio`)

## Quick Start

### Docker Compose

`edge` tag refers to the default branch. The following example is intended for a
local development setup where Redis and MinIO run as sibling containers; service
hostnames are used rather than `localhost` which would point to the container
itself.

```yaml
services:
  atrium:
    image: "ghcr.io/aldy505/atrium:edge"
    ports:
      - "3000:3000"
    environment:
      REDIS_URL: "redis://redis:6379"
      S3_ENDPOINT: "http://minio:9000"
      S3_REGION: "us-east-1"
      S3_FORCE_PATH_STYLE: true
  redis:
    image: redis:7-alpine
  minio:
    image: minio/minio:latest
    command: server /data
    environment:
      MINIO_ROOT_USER: "minioadmin"
      MINIO_ROOT_PASSWORD: "minioadmin"
    ports:
      - "9000:9000"
```
### Pre-built Artifacts

If you prefer to run it directly using Node, you can download the pre-built
artifacts from the [latest GitHub Actions run](https://github.com/aldy505/atrium/actions/workflows/ci.yaml).

1. Download the artifacts that correspond with your environment (Linux amd64, Linux arm64, or Windows).
2. Extract the archive (`unzip atrium-{platform}-{sha}.zip`)
3. Run it using Node.js (`node --import ./dist/server/sentry.server.js ./dist/server/index.js`)

### From source

1. Copy env template:

```bash
cp .env.example .env
```

2. Start all services:

```bash
docker compose up --build
```

3. Open Atrium:

- App: http://localhost:3000
- MinIO API: http://localhost:9000
- MinIO Console: http://localhost:9001

4. Login to Atrium using MinIO test credentials:

- Access Key ID: `minioadmin`
- Secret Access Key: `minioadmin`

5. Create a bucket in MinIO Console first, then browse/upload/download/delete through Atrium.

## Environment Variables

| Variable                                       | Required   | Default          | Description                                   |
| ---------------------------------------------- | ---------- | ---------------- | --------------------------------------------- |
| `NODE_ENV`                                     | no         | `development`    | Runtime environment                           |
| `PORT`                                         | no         | `3000`           | API/web app port                              |
| `REDIS_URL`                                    | yes        | -                | Redis connection URL                          |
| `SESSION_TTL_SECONDS`                          | no         | `86400`          | Session TTL in seconds                        |
| `COOKIE_NAME`                                  | no         | `atrium_session` | Session cookie name                           |
| `BUCKET_SIZE_CALC_INTERVAL_HOURS`              | no         | `1`              | Background bucket-size job interval (hours)   |
| `BUCKET_SIZE_MAX_DURATION_MS`                  | no         | `300000`         | Max runtime per bucket size calculation       |
| `BUCKET_SIZE_MAX_OBJECTS`                      | no         | `1000000`        | Max objects scanned per calculation           |
| `ENABLE_S3_URI_COPY`                           | no         | `false`          | Show "Copy S3 URI" action in object sidebar |
| `S3_ENDPOINT`                                  | yes        | -                | S3-compatible endpoint URL                    |
| `S3_REGION`                                    | yes        | -                | S3 region string                              |
| `S3_FORCE_PATH_STYLE`                          | no         | `true`           | Use path-style S3 URLs (needed by MinIO)      |
| `MAX_UPLOAD_SIZE_MB`                           | no         | `100`            | Per-file upload size limit                    |
| `AUDIT_LOG_SINK`                               | no         | `filesystem`     | Audit log sink (`filesystem`, `loki`, `none`) |
| `AUDIT_LOG_DIR`                                | no         | `audit-logs`     | Filesystem audit log directory                |
| `AUDIT_LOG_RETENTION_DAYS`                     | no         | `30`             | Filesystem audit log retention (days)         |
| `AUDIT_LOG_LOKI_URL`                           | no         | -                | Loki push endpoint (required for `loki`)      |
| `SENTRY_DSN`                                   | no         | -                | Backend Sentry DSN                            |
| `SENTRY_ENVIRONMENT`                           | no         | `development`    | Backend Sentry environment                    |
| `SENTRY_RELEASE`                               | no         | `atrium@0.1.0`   | Backend release identifier                    |
| `SENTRY_TRACES_SAMPLE_RATE`                    | no         | `0.1`            | Backend tracing sample rate                   |
| `SENTRY_ENABLE_LOGS`                           | no         | `true`           | Enable backend Sentry logs                    |
| `SENTRY_ENABLE_METRICS`                        | no         | `true`           | Enable backend Sentry metrics                 |
| `FRONTEND_SENTRY_DSN`                          | no         | -                | Frontend Sentry DSN (runtime via API)         |
| `FRONTEND_SENTRY_ENVIRONMENT`                  | no         | `NODE_ENV`       | Frontend Sentry environment (runtime)         |
| `FRONTEND_SENTRY_RELEASE`                      | no         | -                | Frontend release identifier (runtime)         |
| `FRONTEND_SENTRY_TRACES_SAMPLE_RATE`           | no         | `0.1`            | Frontend tracing sample rate (runtime)        |
| `FRONTEND_SENTRY_ENABLE_LOGS`                  | no         | `true`           | Enable frontend Sentry logs (runtime)         |
| `FRONTEND_SENTRY_ENABLE_METRICS`               | no         | `true`           | Enable frontend Sentry metrics (runtime)      |
| `FRONTEND_SENTRY_REPLAYS_SESSION_SAMPLE_RATE`  | no         | `0.1`            | Frontend replay session sample (runtime)      |
| `FRONTEND_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE` | no         | `1.0`            | Frontend replay-on-error sample (runtime)     |
| Variable                                       | Required | Default          | Description                                   |
| ---------------------------------------------- | -------- | ---------------- | --------------------------------------------- |
| `NODE_ENV`                                     | no       | `development`    | Runtime environment                           |
| `PORT`                                         | no       | `3000`           | API/web app port                              |
| `REDIS_URL`                                    | yes      | -                | Redis connection URL                          |
| `SESSION_TTL_SECONDS`                          | no       | `86400`          | Session TTL in seconds                        |
| `COOKIE_NAME`                                  | no       | `atrium_session` | Session cookie name                           |
| `BUCKET_SIZE_CALC_INTERVAL_HOURS`              | no       | `1`              | Background bucket-size job interval (hours)   |
| `BUCKET_SIZE_MAX_DURATION_MS`                  | no       | `300000`         | Max runtime per bucket size calculation       |
| `BUCKET_SIZE_MAX_OBJECTS`                      | no       | `1000000`        | Max objects scanned per calculation           |
| `S3_ENDPOINT`                                  | yes      | -                | S3-compatible endpoint URL                    |
| `S3_REGION`                                    | yes      | -                | S3 region string                              |
| `S3_FORCE_PATH_STYLE`                          | no       | `true`           | Use path-style S3 URLs (needed by MinIO)      |
| `MAX_UPLOAD_SIZE_MB`                           | no       | `100`            | Per-file upload size limit                    |
| `AUDIT_LOG_SINK`                               | no       | `filesystem`     | Audit log sink (`filesystem`, `loki`, `none`) |
| `AUDIT_LOG_DIR`                                | no       | `audit-logs`     | Filesystem audit log directory                |
| `AUDIT_LOG_RETENTION_DAYS`                     | no       | `30`             | Filesystem audit log retention (days)         |
| `AUDIT_LOG_LOKI_URL`                           | no       | -                | Loki push endpoint (required for `loki`)      |
| `SENTRY_DSN`                                   | no       | -                | Backend Sentry DSN                            |
| `SENTRY_ENVIRONMENT`                           | no       | `development`    | Backend Sentry environment                    |
| `SENTRY_RELEASE`                               | no       | `atrium@0.1.0`   | Backend release identifier                    |
| `SENTRY_TRACES_SAMPLE_RATE`                    | no       | `0.1`            | Backend tracing sample rate                   |
| `SENTRY_ENABLE_LOGS`                           | no       | `true`           | Enable backend Sentry logs                    |
| `SENTRY_ENABLE_METRICS`                        | no       | `true`           | Enable backend Sentry metrics                 |
| `FRONTEND_SENTRY_DSN`                          | no       | -                | Frontend Sentry DSN (runtime via API)         |
| `FRONTEND_SENTRY_ENVIRONMENT`                  | no       | `NODE_ENV`       | Frontend Sentry environment (runtime)         |
| `FRONTEND_SENTRY_RELEASE`                      | no       | -                | Frontend release identifier (runtime)         |
| `FRONTEND_SENTRY_TRACES_SAMPLE_RATE`           | no       | `0.1`            | Frontend tracing sample rate (runtime)        |
| `FRONTEND_SENTRY_ENABLE_LOGS`                  | no       | `true`           | Enable frontend Sentry logs (runtime)         |
| `FRONTEND_SENTRY_ENABLE_METRICS`               | no       | `true`           | Enable frontend Sentry metrics (runtime)      |
| `FRONTEND_SENTRY_REPLAYS_SESSION_SAMPLE_RATE`  | no       | `0.1`            | Frontend replay session sample (runtime)      |
| `FRONTEND_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE` | no       | `1.0`            | Frontend replay-on-error sample (runtime)     |


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
- MinIO test credentials are `minioadmin` for access key and `minioadmin` for secret key.

## Optional Features

- `ENABLE_S3_URI_COPY=true` enables a **Copy S3 URI** button in the object detail sidebar.
  - Copies `s3://<bucket>/<key>` to clipboard for files and folders.
  - Uses Clipboard API with a fallback for older browsers.

## Production Build

```bash
pnpm build
pnpm start
```

- Backend Sentry initializes via Node ESM preload (`--import ./dist/server/sentry.server.js`) before Fastify boot.
- Frontend Sentry runtime settings are fetched from `/api/runtime-config` at app startup. Configure values via `FRONTEND_SENTRY_*` environment variables; the server does not rely on build-time values.

## Large Bucket Performance

- Object listing is cursor-paginated server-side via S3 `ListObjectsV2` (`maxKeys` + continuation token).
- Server-side folder/page listing cache is stored in Redis and keyed by session + bucket + prefix + continuation token + page size.
- Cached list responses use TTL-based expiration (default `300s`) and can be toggled with `S3_LIST_CACHE_ENABLED`.
- Cache invalidation runs after upload/delete operations with default `targeted` mode (prefix + parent prefixes), or `bucket` mode via `S3_LIST_CACHE_INVALIDATION_MODE`.
- Optional diagnostics header `X-Atrium-S3-List-Cache` reports `HIT`, `MISS`, or `BYPASS` when `S3_LIST_CACHE_INCLUDE_HEADERS=true`.
- Optional background bucket-size calculation can be enabled with OpenFeature flag `enable-background-bucket-size-calculation`.
- Bucket-size API routes (feature-gated): `GET /api/s3/buckets/:bucketName/size` and `POST /api/s3/buckets/:bucketName/size/calculate`.
- Frontend requests objects in pages of `200` and merges pages in memory.
- The object table supports:
  - Manual pagination with **Load more**
  - Optional **Auto-load on scroll** (IntersectionObserver)
- For stress testing, this repository has been validated with a generated dataset of `5000` objects in MinIO.

### Bucket Size Calculation Cost Notes

- Bucket-size calculation uses paged `ListObjectsV2` calls (up to `1000` objects per request).
- AWS S3 pricing is roughly `$0.005` per `1,000` LIST requests.
- A bucket with `1,000,000` objects needs around `1,000` list calls (~`$0.005`) for one full calculation.
- Running this hourly across many large buckets can add noticeable cost; tune interval and limits accordingly.

## Sentry Metrics

### Backend HTTP

- `http.requests.total` (count)
- `http.server.duration` (distribution, milliseconds)
- `http.requests.errors` (count)

### Upstream S3 Metrics

- Latency per operation (distribution, milliseconds):
  - `s3.list_buckets.latency`
  - `s3.list_objects_v2.latency`
  - `s3.put_object.latency`
  - `s3.get_object.latency`
  - `s3.delete_object.latency`
- Transfer activity gauges:
  - `s3.upload.files_in_flight`
  - `s3.download.files_in_flight`

### Authentication Gauges

- `auth.success`
- `auth.failure`

Notes:

- Auth gauges represent process-local totals and reset on server restart.
- Frontend emits `frontend.app.boot` at initialization when frontend Sentry is enabled.

## Security Notes

- Credentials are never persisted in browser storage.
- Session cookie is `httpOnly`; `secure` is enabled automatically in production mode.
- Credentials are stored server-side in Redis under random high-entropy tokens with TTL.
- Sessions are isolated; each token maps to one credential pair.
- Endpoint and region are controlled by backend environment variables only.

## Open Source Notes

This repository is designed for self-hosting and extension. Future versions can add sharing links, batch operations, richer previews, and ACL tooling.

## License

```
Copyright 2026 Reinaldy Rafli

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

See [LICENSE](./LICENSE).
