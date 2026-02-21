import crypto from "node:crypto";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { OpenFeature } from "@openfeature/server-sdk";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { AsyncTask, SimpleIntervalJob } from "toad-scheduler";
import { config } from "./config.js";
import type { SessionCredentials } from "./types.js";

const redis = new Redis(config.REDIS_URL);
const redisKeyPrefix = "atrium";
const bucketSizeFeatureFlag = "enable-background-bucket-size-calculation";
const trackedSessionBucketsTTLSeconds = 86400 * 7;
const progressLogEveryObjects = 50000;

export type BucketSizeResult = {
  bucket: string;
  totalSize: number;
  objectCount: number;
  isApproximate: boolean;
  isInaccessible: boolean;
  error?: string;
  calculatedAt: number;
  durationMs: number;
  sizeFormatted: string;
};

const encodeSegment = (value: string): string => Buffer.from(value, "utf8").toString("base64url");
const sessionKey = (token: string): string => `${redisKeyPrefix}:session:${token}`;
const sessionBucketKey = (token: string): string => `${redisKeyPrefix}:session-buckets:${token}`;

const getS3Client = (credentials: SessionCredentials): S3Client => {
  return new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials,
  });
};

const getCredentialScope = (accessKeyId: string): string => {
  return crypto.createHash("sha256").update(accessKeyId).digest("hex").slice(0, 16);
};

const bucketSizeKey = (bucketName: string, accessKeyId: string): string => {
  return `${redisKeyPrefix}:bucket-size:${getCredentialScope(accessKeyId)}:${encodeSegment(bucketName)}`;
};

const bucketSizeLockKey = (bucketName: string, accessKeyId: string): string => {
  return `${redisKeyPrefix}:lock:bucket-size:${getCredentialScope(accessKeyId)}:${encodeSegment(bucketName)}`;
};

const parseSessionCredentials = (value: string | null): SessionCredentials | null => {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<SessionCredentials>;
    if (
      typeof parsed === "object" &&
      typeof parsed?.accessKeyId === "string" &&
      typeof parsed?.secretAccessKey === "string"
    ) {
      return {
        accessKeyId: parsed.accessKeyId,
        secretAccessKey: parsed.secretAccessKey,
      };
    }
  } catch {
    return null;
  }

  return null;
};

const parseBucketSizeResult = (value: string | null): BucketSizeResult | null => {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as BucketSizeResult;
  } catch {
    return null;
  }
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

export const isBackgroundBucketSizeCalculationEnabled = async (): Promise<boolean> => {
  try {
    return await OpenFeature.getClient().getBooleanValue(bucketSizeFeatureFlag, false);
  } catch {
    return false;
  }
};

export const trackBucketAccess = async (
  sessionToken: string,
  bucketName: string,
): Promise<void> => {
  await redis.sadd(sessionBucketKey(sessionToken), bucketName);
  await redis.expire(sessionBucketKey(sessionToken), trackedSessionBucketsTTLSeconds);
};

const getTrackedBucketsForSession = async (sessionToken: string): Promise<string[]> => {
  return redis.smembers(sessionBucketKey(sessionToken));
};

export const getBucketSizeCacheTtlSeconds = (objectCount: number): number => {
  if (objectCount < 10000) {
    return 3600;
  }

  if (objectCount < 100000) {
    return 86400;
  }

  return 86400 * 7;
};

export const isBucketSizeResultFresh = (result: BucketSizeResult, now = Date.now()): boolean => {
  const ageHours = (now - result.calculatedAt) / (1000 * 60 * 60);

  if (result.objectCount < 10000) {
    return ageHours < 1;
  }

  if (result.objectCount < 100000) {
    return ageHours < 24;
  }

  return ageHours < 168;
};

const formatBytes = (bytes: number): string => {
  if (bytes <= 0) {
    return "0 Bytes";
  }

  const units = ["Bytes", "KB", "MB", "GB", "TB", "PB"];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** idx;
  return `${value.toFixed(2)} ${units[idx]}`;
};

const isPermissionDeniedError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    name?: string;
    code?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  const code = candidate.Code || candidate.code || candidate.name;

  return (
    code === "AccessDenied" || code === "Forbidden" || candidate.$metadata?.httpStatusCode === 403
  );
};

const calculateBucketSize = async (
  bucketName: string,
  credentials: SessionCredentials,
  logger: FastifyBaseLogger,
): Promise<BucketSizeResult> => {
  const client = getS3Client(credentials);
  const startedAt = Date.now();

  let totalSize = 0;
  let objectCount = 0;
  let continuationToken: string | undefined;
  let isApproximate = false;

  do {
    if (Date.now() - startedAt > config.BUCKET_SIZE_MAX_DURATION_MS) {
      logger.warn({ bucket: bucketName }, "Bucket size calculation exceeded max duration");
      isApproximate = true;
      break;
    }

    if (objectCount >= config.BUCKET_SIZE_MAX_OBJECTS) {
      logger.warn({ bucket: bucketName }, "Bucket size calculation reached max object limit");
      isApproximate = true;
      break;
    }

    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      }),
    );

    for (const item of response.Contents ?? []) {
      totalSize += item.Size ?? 0;
      objectCount += 1;

      if (objectCount > 0 && objectCount % progressLogEveryObjects === 0) {
        logger.info(
          { bucket: bucketName, objectCount, sizeFormatted: formatBytes(totalSize) },
          "Bucket size calculation progress",
        );
      }

      if (objectCount >= config.BUCKET_SIZE_MAX_OBJECTS) {
        logger.warn({ bucket: bucketName }, "Bucket size calculation reached max object limit");
        isApproximate = true;
        break;
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken && !isApproximate);

  return {
    bucket: bucketName,
    totalSize,
    objectCount,
    isApproximate,
    isInaccessible: false,
    calculatedAt: Date.now(),
    durationMs: Date.now() - startedAt,
    sizeFormatted: formatBytes(totalSize),
  };
};

const storeBucketSizeResult = async (
  bucketName: string,
  accessKeyId: string,
  result: BucketSizeResult,
): Promise<void> => {
  await redis.set(
    bucketSizeKey(bucketName, accessKeyId),
    JSON.stringify(result),
    "EX",
    getBucketSizeCacheTtlSeconds(result.objectCount),
  );
};

export const getCachedBucketSize = async (
  bucketName: string,
  accessKeyId: string,
): Promise<BucketSizeResult | null> => {
  return parseBucketSizeResult(await redis.get(bucketSizeKey(bucketName, accessKeyId)));
};

type BucketSizeCalculationStatus = "calculated" | "already-locked" | "already-fresh";

export const calculateBucketSizeWithLock = async (
  bucketName: string,
  credentials: SessionCredentials,
  logger: FastifyBaseLogger,
  options?: { force?: boolean },
): Promise<BucketSizeCalculationStatus> => {
  if (!options?.force) {
    const existing = await getCachedBucketSize(bucketName, credentials.accessKeyId);
    if (existing && isBucketSizeResultFresh(existing)) {
      return "already-fresh";
    }
  }

  const lockTtlSeconds = Math.max(Math.ceil(config.BUCKET_SIZE_MAX_DURATION_MS / 1000) + 60, 300);
  const workerId = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const lockKey = bucketSizeLockKey(bucketName, credentials.accessKeyId);
  const acquired = await redis.set(lockKey, workerId, "EX", lockTtlSeconds, "NX");

  if (!acquired) {
    return "already-locked";
  }

  try {
    const result = await calculateBucketSize(bucketName, credentials, logger);
    await storeBucketSizeResult(bucketName, credentials.accessKeyId, result);
    return "calculated";
  } catch (error) {
    const now = Date.now();
    if (isPermissionDeniedError(error)) {
      await storeBucketSizeResult(bucketName, credentials.accessKeyId, {
        bucket: bucketName,
        totalSize: 0,
        objectCount: 0,
        isApproximate: false,
        isInaccessible: true,
        error: "Access denied",
        calculatedAt: now,
        durationMs: 0,
        sizeFormatted: "0 Bytes",
      });
      return "calculated";
    }

    await storeBucketSizeResult(bucketName, credentials.accessKeyId, {
      bucket: bucketName,
      totalSize: 0,
      objectCount: 0,
      isApproximate: true,
      isInaccessible: false,
      error: error instanceof Error ? error.message : "Unknown error",
      calculatedAt: now,
      durationMs: 0,
      sizeFormatted: "0 Bytes",
    });
    return "calculated";
  } finally {
    const lockOwner = await redis.get(lockKey);
    if (lockOwner === workerId) {
      await redis.del(lockKey);
    }
  }
};

const runBackgroundBucketSizeCycle = async (logger: FastifyBaseLogger): Promise<void> => {
  const enabled = await isBackgroundBucketSizeCalculationEnabled();
  if (!enabled) {
    return;
  }

  const keys = await scanKeys(`${redisKeyPrefix}:session:*`);

  for (const key of keys) {
    const token = key.slice(sessionKey("").length);
    if (!token) {
      continue;
    }

    const credentials = parseSessionCredentials(await redis.get(sessionKey(token)));
    if (!credentials) {
      continue;
    }

    const buckets = await getTrackedBucketsForSession(token);
    for (const bucket of buckets) {
      await calculateBucketSizeWithLock(bucket, credentials, logger);
    }
  }
};

export const registerBucketSizeScheduler = async (app: FastifyInstance): Promise<void> => {
  const enabled = await isBackgroundBucketSizeCalculationEnabled();
  if (!enabled) {
    app.log.info("Background bucket size calculation is disabled");
    return;
  }

  const task = new AsyncTask(
    "bucket-size-calculation",
    async () => {
      await runBackgroundBucketSizeCycle(app.log);
    },
    (error) => {
      app.log.error({ error }, "Bucket size scheduler task failed");
    },
  );

  const job = new SimpleIntervalJob(
    { hours: config.BUCKET_SIZE_CALC_INTERVAL_HOURS, runImmediately: false },
    task,
  );

  app.scheduler.addSimpleIntervalJob(job);
  app.log.info(
    { hours: config.BUCKET_SIZE_CALC_INTERVAL_HOURS },
    "Background bucket size scheduler registered",
  );
};

export const closeBucketSizeRedis = async (): Promise<void> => {
  await redis.quit();
};
