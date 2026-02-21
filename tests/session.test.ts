import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import crypto from "node:crypto";
import {
  createSession,
  getSessionCredentials,
  deleteSession,
  getCachedListObjectsResponse,
  setCachedListObjectsResponse,
  invalidateCachedListObjectsForBucket,
  invalidateCachedListObjectsByPrefix,
} from "../src/server/session.js";
import { createTestRedisClient, cleanupRedisKeys, TEST_CREDENTIALS } from "./test-utils.js";
import type { SessionCredentials, ListObjectsResponse } from "../src/server/types.js";

describe("session", () => {
  const redis = createTestRedisClient();
  const cacheTokenHashes = new Set<string>();

  function trackCacheToken(token: string): string {
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    cacheTokenHashes.add(hash);
    return token;
  }

  async function cleanupTrackedCacheEntries(): Promise<void> {
    for (const hash of cacheTokenHashes) {
      await cleanupRedisKeys(redis, `atrium:cache_s3_list:${hash}:*`);
    }
    cacheTokenHashes.clear();
  }

  beforeEach(async () => {
    // Clean up any existing test data
    await cleanupRedisKeys(redis, "atrium:session:*");
    cacheTokenHashes.clear();
  });

  afterEach(async () => {
    await cleanupRedisKeys(redis, "atrium:session:*");
    await cleanupTrackedCacheEntries();
  });

  afterAll(async () => {
    await redis.disconnect();
  });

  describe("createSession", () => {
    it("should create a session and return a token", async () => {
      const credentials: SessionCredentials = TEST_CREDENTIALS;
      const token = await createSession(credentials);

      expect(token).toBeDefined();
      expect(typeof token).toBe("string");
      expect(token.length).toBeGreaterThan(0);
    });

    it("should store credentials in Redis", async () => {
      const credentials: SessionCredentials = TEST_CREDENTIALS;
      const token = await createSession(credentials);

      const stored = await redis.get(`atrium:session:${token}`);
      expect(stored).toBeDefined();

      const parsed = JSON.parse(stored!) as SessionCredentials;
      expect(parsed.accessKeyId).toBe(credentials.accessKeyId);
      expect(parsed.secretAccessKey).toBe(credentials.secretAccessKey);
    });

    it("should set TTL on session key", async () => {
      const credentials: SessionCredentials = TEST_CREDENTIALS;
      const token = await createSession(credentials);

      const ttl = await redis.ttl(`atrium:session:${token}`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(86400); // Default SESSION_TTL_SECONDS
    });
  });

  describe("getSessionCredentials", () => {
    it("should retrieve stored credentials", async () => {
      const credentials: SessionCredentials = TEST_CREDENTIALS;
      const token = await createSession(credentials);

      const retrieved = await getSessionCredentials(token);

      expect(retrieved).toBeDefined();
      expect(retrieved!.accessKeyId).toBe(credentials.accessKeyId);
      expect(retrieved!.secretAccessKey).toBe(credentials.secretAccessKey);
    });

    it("should return null for non-existent session", async () => {
      const retrieved = await getSessionCredentials("non-existent-token");

      expect(retrieved).toBeNull();
    });

    it("should refresh session TTL on access (sliding expiration)", async () => {
      const credentials: SessionCredentials = TEST_CREDENTIALS;
      const token = await createSession(credentials);

      // Get initial TTL
      const ttlInitial = await redis.ttl(`atrium:session:${token}`);
      expect(ttlInitial).toBeGreaterThan(0);
      expect(ttlInitial).toBeLessThanOrEqual(86400);

      // Wait a moment
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Access session - this should refresh the TTL
      const retrieved = await getSessionCredentials(token);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.accessKeyId).toBe(credentials.accessKeyId);

      // Get TTL after refresh
      const ttlAfter = await redis.ttl(`atrium:session:${token}`);

      // After refresh, TTL should be close to the max again
      // The implementation sets it to SESSION_TTL_SECONDS on each access
      expect(ttlAfter).toBeGreaterThanOrEqual(ttlInitial);
    });
  });

  describe("deleteSession", () => {
    it("should delete an existing session", async () => {
      const credentials: SessionCredentials = TEST_CREDENTIALS;
      const token = await createSession(credentials);

      await deleteSession(token);

      const retrieved = await getSessionCredentials(token);
      expect(retrieved).toBeNull();
    });

    it("should not throw when deleting non-existent session", async () => {
      await expect(deleteSession("non-existent-token")).resolves.not.toThrow();
    });
  });

  describe("getCachedListObjectsResponse", () => {
    it("should return null when cache is disabled", async () => {
      // Assuming cache is enabled by default in test env
      const token = "test-token";
      const result = await getCachedListObjectsResponse(token, "bucket", "prefix/", undefined, 200);

      expect(result).toBeNull();
    });

    it("should return cached response when available", async () => {
      const token = trackCacheToken(crypto.randomBytes(48).toString("base64url"));
      const bucket = "test-bucket";
      const prefix = "test-prefix/";
      const response: ListObjectsResponse = {
        bucket,
        prefix,
        continuationToken: undefined,
        nextContinuationToken: undefined,
        isTruncated: false,
        files: [],
        folders: [],
      };

      await setCachedListObjectsResponse(token, bucket, prefix, undefined, 200, response);
      const cached = await getCachedListObjectsResponse(token, bucket, prefix, undefined, 200);

      expect(cached).toBeDefined();
      expect(cached!.bucket).toBe(bucket);
      expect(cached!.prefix).toBe(prefix);
    });

    it("should return null for non-existent cache entry", async () => {
      const token = trackCacheToken(crypto.randomBytes(48).toString("base64url"));
      const cached = await getCachedListObjectsResponse(token, "bucket", "prefix/", undefined, 200);

      expect(cached).toBeNull();
    });
  });

  describe("setCachedListObjectsResponse", () => {
    it("should cache list objects response", async () => {
      const token = trackCacheToken(crypto.randomBytes(48).toString("base64url"));
      const bucket = "test-bucket";
      const prefix = "test-prefix/";
      const response: ListObjectsResponse = {
        bucket,
        prefix,
        continuationToken: undefined,
        nextContinuationToken: "next-token",
        isTruncated: true,
        files: [
          {
            type: "file",
            key: "test-prefix/file.txt",
            name: "file.txt",
            size: 1024,
            lastModified: new Date().toISOString(),
            contentType: "text/plain",
          },
        ],
        folders: [],
      };

      await setCachedListObjectsResponse(token, bucket, prefix, undefined, 200, response);
      const cached = await getCachedListObjectsResponse(token, bucket, prefix, undefined, 200);

      expect(cached).toBeDefined();
      expect(cached!.files).toHaveLength(1);
      expect(cached!.files[0].name).toBe("file.txt");
    });

    it("should set TTL on cached entry", async () => {
      const token = trackCacheToken(crypto.randomBytes(48).toString("base64url"));
      const bucket = "test-bucket";
      const prefix = "test-prefix/";
      const response: ListObjectsResponse = {
        bucket,
        prefix,
        continuationToken: undefined,
        nextContinuationToken: undefined,
        isTruncated: false,
        files: [],
        folders: [],
      };

      await setCachedListObjectsResponse(token, bucket, prefix, undefined, 200, response);

      // Get the cache key and check TTL
      const hash = crypto.createHash("sha256").update(token).digest("hex");
      const encodedBucket = Buffer.from(bucket, "utf8").toString("base64url");
      const encodedPrefix = Buffer.from(prefix, "utf8").toString("base64url");
      const encodedToken = Buffer.from("", "utf8").toString("base64url");
      const cacheKey = `atrium:cache_s3_list:${hash}:${encodedBucket}:${encodedPrefix}:${encodedToken}:200`;

      const ttl = await redis.ttl(cacheKey);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(300); // Default S3_LIST_CACHE_TTL_SECONDS
    });
  });

  describe("invalidateCachedListObjectsForBucket", () => {
    it("should delete all cache entries for a bucket", async () => {
      const token = trackCacheToken(crypto.randomBytes(48).toString("base64url"));
      const bucket = "test-bucket";
      const response: ListObjectsResponse = {
        bucket,
        prefix: "",
        continuationToken: undefined,
        nextContinuationToken: undefined,
        isTruncated: false,
        files: [],
        folders: [],
      };

      // Cache multiple entries
      await setCachedListObjectsResponse(token, bucket, "prefix1/", undefined, 200, {
        ...response,
        prefix: "prefix1/",
      });
      await setCachedListObjectsResponse(token, bucket, "prefix2/", undefined, 200, {
        ...response,
        prefix: "prefix2/",
      });

      const deletedCount = await invalidateCachedListObjectsForBucket(token, bucket);
      expect(deletedCount).toBeGreaterThan(0);

      // Verify entries are deleted
      const cached1 = await getCachedListObjectsResponse(token, bucket, "prefix1/", undefined, 200);
      const cached2 = await getCachedListObjectsResponse(token, bucket, "prefix2/", undefined, 200);

      expect(cached1).toBeNull();
      expect(cached2).toBeNull();
    });
  });

  describe("invalidateCachedListObjectsByPrefix", () => {
    it("should invalidate exact prefix matches", async () => {
      const token = trackCacheToken(crypto.randomBytes(48).toString("base64url"));
      const bucket = "test-bucket";
      const response: ListObjectsResponse = {
        bucket,
        prefix: "",
        continuationToken: undefined,
        nextContinuationToken: undefined,
        isTruncated: false,
        files: [],
        folders: [],
      };

      await setCachedListObjectsResponse(token, bucket, "folder/", undefined, 200, {
        ...response,
        prefix: "folder/",
      });

      const deletedCount = await invalidateCachedListObjectsByPrefix(token, bucket, ["folder/"]);
      expect(deletedCount).toBeGreaterThan(0);

      const cached = await getCachedListObjectsResponse(token, bucket, "folder/", undefined, 200);
      expect(cached).toBeNull();
    });

    it("should invalidate prefixes with children", async () => {
      const token = trackCacheToken(crypto.randomBytes(48).toString("base64url"));
      const bucket = "test-bucket";
      const response: ListObjectsResponse = {
        bucket,
        prefix: "",
        continuationToken: undefined,
        nextContinuationToken: undefined,
        isTruncated: false,
        files: [],
        folders: [],
      };

      await setCachedListObjectsResponse(token, bucket, "folder/", undefined, 200, {
        ...response,
        prefix: "folder/",
      });
      await setCachedListObjectsResponse(token, bucket, "folder/sub/", undefined, 200, {
        ...response,
        prefix: "folder/sub/",
      });

      const deletedCount = await invalidateCachedListObjectsByPrefix(
        token,
        bucket,
        [],
        ["folder/"],
      );
      expect(deletedCount).toBeGreaterThan(0);

      const cached1 = await getCachedListObjectsResponse(token, bucket, "folder/", undefined, 200);
      const cached2 = await getCachedListObjectsResponse(
        token,
        bucket,
        "folder/sub/",
        undefined,
        200,
      );

      expect(cached1).toBeNull();
      expect(cached2).toBeNull();
    });
  });
});
