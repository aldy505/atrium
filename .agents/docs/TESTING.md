# Backend Testing Documentation

## Overview

Comprehensive unit tests have been implemented for the backend using Vitest. Tests connect to real MinIO (S3-compatible) and Redis services for integration testing.

## Test Coverage

### Test Files Created

1. **errors.test.ts** (7 tests)
   - Tests for `AppError` class
   - Tests for `toErrorMessage` utility

2. **config.test.ts** (10 tests)
   - Configuration validation
   - Environment variable parsing
   - Cookie configuration

3. **session.test.ts** (16 tests)
   - Session creation and storage
   - Session TTL and sliding expiration
   - Cache invalidation strategies
   - Redis operations

4. **auth.test.ts** (11 tests)
   - Login endpoint with credential validation
   - Logout endpoint
   - Session middleware (`requireSession`)
   - `/api/auth/me` endpoint

5. **s3.test.ts** (17 tests)
   - Credential validation
   - Bucket listing
   - Object listing with pagination
   - Object upload/download/delete
   - Content type inference

**Total: 61 passing tests**

## Test Infrastructure

### Configuration Files

- `vitest.config.ts` - Vitest configuration with coverage settings
- `src/server/vitest.setup.ts` - Test environment setup
- `src/server/test-utils.ts` - Shared test utilities

### Test Services

Tests use actual services:

- **MinIO**: `http://127.0.0.1:9000` (default credentials: minioadmin/minioadmin)
- **Redis**: `redis://127.0.0.1:6379`

### Environment Variables for Tests

```bash
REDIS_URL=redis://127.0.0.1:6379
S3_ENDPOINT=http://127.0.0.1:9000
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true
TEST_MINIO_ENDPOINT=http://127.0.0.1:9000
TEST_REDIS_URL=redis://127.0.0.1:6379
TEST_ACCESS_KEY_ID=minioadmin
TEST_SECRET_ACCESS_KEY=minioadmin
```

## Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with UI
pnpm test:ui

# Run tests with coverage
pnpm test:coverage
```

## GitHub Actions CI/CD

A GitHub Actions workflow (`.github/workflows/ci.yml`) has been configured with:

### Service Containers

- **Redis**: `redis:7-alpine` with health checks
- **MinIO**: `minio/minio:latest` with health checks

### CI Steps

1. Checkout code
2. Setup pnpm and Node.js
3. Install dependencies
4. Run type checking
5. Run linter
6. Run formatter check
7. Run tests
8. Generate coverage report
9. Upload coverage to Codecov
10. Build project

### Workflow Triggers

- Push to `main` or `develop` branches
- Pull requests to `main` or `develop` branches

## Test Patterns

### Mocking

- S3 `validateCredentials` is mocked in auth tests
- Audit and observability functions are mocked where appropriate

### Cleanup

- Tests clean up Redis keys with pattern matching
- S3 test buckets are created with unique timestamps

### Assertions

- Uses Vitest's expect API (Jest-compatible)
- Tests verify both success and error paths
- Includes edge cases and validation

## Coverage Report

Coverage is configured for:

- **Provider**: V8
- **Reporters**: text, json, html
- **Includes**: `src/server/**/*.ts`
- **Excludes**: test files, entry points, setup files

Run `pnpm test:coverage` to generate a full coverage report in the `coverage/` directory.
