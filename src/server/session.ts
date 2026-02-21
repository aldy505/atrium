import crypto from "node:crypto";
import { Redis } from "ioredis";
import { config } from "./config.js";
import type { ListObjectsResponse, SessionCredentials } from "./types.js";

const redis = new Redis(config.REDIS_URL);

const redisKeyPrefix = "atrium";
const sessionKey = (token: string) => `${redisKeyPrefix}:session:${token}`;
const listCacheKeyPrefix = `${redisKeyPrefix}:cache_s3_list`;

const encodeSegment = (value: string): string => Buffer.from(value, "utf8").toString("base64url");

const decodeSegment = (value: string): string | null => {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
};

const hashSessionToken = (token: string): string => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

const listCacheBucketNamespace = (sessionToken: string, bucket: string): string => {
  return `${listCacheKeyPrefix}:${hashSessionToken(sessionToken)}:${encodeSegment(bucket)}`;
};

const listCacheKey = (
  sessionToken: string,
  bucket: string,
  prefix: string,
  continuationToken: string | undefined,
  maxKeys: number,
): string => {
  return `${listCacheBucketNamespace(sessionToken, bucket)}:${encodeSegment(prefix)}:${encodeSegment(continuationToken || "")}:${maxKeys}`;
};

const scanKeys = async (pattern: string): Promise<string[]> => {
  let cursor = "0";
  const matchedKeys: string[] = [];

  do {
    const [nextCursor, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", "200");
    cursor = nextCursor;

    if (batch.length) {
      matchedKeys.push(...batch);
    }
  } while (cursor !== "0");

  return matchedKeys;
};

const deleteKeys = async (keys: string[]): Promise<number> => {
  if (!keys.length) {
    return 0;
  }

  let deleted = 0;

  for (let index = 0; index < keys.length; index += 500) {
    const batch = keys.slice(index, index + 500);
    // Prefer UNLINK for non-blocking deletes
    deleted += await redis.unlink(...batch);
  }

  return deleted;
};

const readPrefixFromListCacheKey = (cacheKey: string): string | null => {
  const prefixWithSeparator = `${listCacheKeyPrefix}:`;

  if (!cacheKey.startsWith(prefixWithSeparator)) {
    return null;
  }

  const segments = cacheKey.slice(prefixWithSeparator.length).split(":");

  if (segments.length !== 5) {
    return null;
  }

  return decodeSegment(segments[2]);
};

export const createSession = async (credentials: SessionCredentials): Promise<string> => {
  const token = crypto.randomBytes(48).toString("base64url");
  const payload = JSON.stringify(credentials);
  await redis.set(sessionKey(token), payload, "EX", config.SESSION_TTL_SECONDS);
  return token;
};

export const getSessionCredentials = async (token: string): Promise<SessionCredentials | null> => {
  const data = await redis.get(sessionKey(token));

  if (!data) {
    return null;
  }

  // Sliding expiration keeps active sessions alive while preserving bounded TTL for idle sessions.
  await redis.expire(sessionKey(token), config.SESSION_TTL_SECONDS);
  return JSON.parse(data) as SessionCredentials;
};

export const deleteSession = async (token: string): Promise<void> => {
  await redis.del(sessionKey(token));
};

export const getCachedListObjectsResponse = async (
  sessionToken: string,
  bucket: string,
  prefix: string,
  continuationToken: string | undefined,
  maxKeys: number,
): Promise<ListObjectsResponse | null> => {
  if (!config.S3_LIST_CACHE_ENABLED) {
    return null;
  }

  const key = listCacheKey(sessionToken, bucket, prefix, continuationToken, maxKeys);
  const value = await redis.get(key);

  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as ListObjectsResponse;
  } catch {
    await redis.del(key);
    return null;
  }
};

export const setCachedListObjectsResponse = async (
  sessionToken: string,
  bucket: string,
  prefix: string,
  continuationToken: string | undefined,
  maxKeys: number,
  response: ListObjectsResponse,
): Promise<void> => {
  if (!config.S3_LIST_CACHE_ENABLED) {
    return;
  }

  const key = listCacheKey(sessionToken, bucket, prefix, continuationToken, maxKeys);
  await redis.set(key, JSON.stringify(response), "EX", config.S3_LIST_CACHE_TTL_SECONDS);
};

export const invalidateCachedListObjectsForBucket = async (
  sessionToken: string,
  bucket: string,
): Promise<number> => {
  if (!config.S3_LIST_CACHE_ENABLED) {
    return 0;
  }

  const keys = await scanKeys(`${listCacheBucketNamespace(sessionToken, bucket)}:*`);
  return deleteKeys(keys);
};

export const invalidateCachedListObjectsByPrefix = async (
  sessionToken: string,
  bucket: string,
  exactPrefixes: string[],
  prefixesWithChildren: string[] = [],
): Promise<number> => {
  if (!config.S3_LIST_CACHE_ENABLED) {
    return 0;
  }

  let keysToDelete: string[] = [];

  // For exactPrefixes, scan only the relevant prefix segment
  for (const prefix of exactPrefixes) {
    const encoded = encodeSegment(prefix);
    const pattern = `${listCacheBucketNamespace(sessionToken, bucket)}:${encoded}:*`;
    const found = await scanKeys(pattern);
    keysToDelete.push(...found);
  }

  // For prefixesWithChildren, still need to scan all keys (could optimize further with an index)
  if (prefixesWithChildren.length) {
    const allKeys = await scanKeys(`${listCacheBucketNamespace(sessionToken, bucket)}:*`);
    for (const cacheKey of allKeys) {
      const cachedPrefix = readPrefixFromListCacheKey(cacheKey);
      if (cachedPrefix === null) continue;
      if (prefixesWithChildren.some((p) => cachedPrefix.startsWith(p))) {
        keysToDelete.push(cacheKey);
      }
    }
  }

  // Remove duplicates
  keysToDelete = Array.from(new Set(keysToDelete));
  return deleteKeys(keysToDelete);
};

export const closeRedis = async (): Promise<void> => {
  await redis.quit();
};
