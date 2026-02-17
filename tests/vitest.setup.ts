import { vi } from "vitest";

// Set up required environment variables for tests BEFORE any imports
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
process.env.S3_ENDPOINT = process.env.S3_ENDPOINT || "http://127.0.0.1:9000";
process.env.S3_REGION = process.env.S3_REGION || "us-east-1";
process.env.S3_FORCE_PATH_STYLE = process.env.S3_FORCE_PATH_STYLE || "true";
process.env.PORT = process.env.PORT || "3000";
process.env.SESSION_TTL_SECONDS = process.env.SESSION_TTL_SECONDS || "86400";
process.env.COOKIE_NAME = process.env.COOKIE_NAME || "atrium_session";
process.env.MAX_UPLOAD_SIZE_MB = process.env.MAX_UPLOAD_SIZE_MB || "100";
process.env.AUDIT_LOG_SINK = process.env.AUDIT_LOG_SINK || "none";
process.env.S3_LIST_CACHE_ENABLED = process.env.S3_LIST_CACHE_ENABLED || "true";
process.env.S3_LIST_CACHE_TTL_SECONDS = process.env.S3_LIST_CACHE_TTL_SECONDS || "300";

// Prevent process.exit from actually exiting during tests
process.exit = vi.fn() as any;

// Restore after all tests
vi.unmock("process");
