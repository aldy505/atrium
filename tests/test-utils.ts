import { Redis } from "ioredis";
import { S3Client } from "@aws-sdk/client-s3";
import type { SessionCredentials } from "../src/server/types.js";

// Test configuration for MinIO and Redis
export const TEST_MINIO_ENDPOINT = process.env.TEST_MINIO_ENDPOINT || "http://127.0.0.1:9000";
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL || "redis://127.0.0.1:6379";
export const TEST_BUCKET = process.env.TEST_BUCKET || "test-bucket";

// Test credentials for MinIO
export const TEST_CREDENTIALS: SessionCredentials = {
  accessKeyId: process.env.TEST_ACCESS_KEY_ID || "minioadmin",
  secretAccessKey: process.env.TEST_SECRET_ACCESS_KEY || "minioadmin",
};

/**
 * Creates a test Redis client
 */
export function createTestRedisClient(): Redis {
  return new Redis(TEST_REDIS_URL);
}

/**
 * Creates a test S3 client
 */
export function createTestS3Client(credentials: SessionCredentials = TEST_CREDENTIALS): S3Client {
  return new S3Client({
    endpoint: TEST_MINIO_ENDPOINT,
    region: "us-east-1",
    forcePathStyle: true,
    credentials,
  });
}

/**
 * Cleans up Redis test data by pattern
 */
export async function cleanupRedisKeys(redis: Redis, pattern: string): Promise<void> {
  let cursor = "0";
  do {
    const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", "100");
    cursor = nextCursor;
    if (keys.length > 0) {
      await redis.unlink(...keys);
    }
  } while (cursor !== "0");
}

/**
 * Generates a random session token for testing
 */
export function generateTestToken(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}
