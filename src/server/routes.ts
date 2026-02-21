import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { hashAccessKeyId, hashSessionToken, recordAuditEvent } from "./audit/index.js";
import { AppError, toErrorMessage } from "./errors.js";
import { requireSession } from "./auth.js";
import {
  calculateBucketSizeWithLock,
  getCachedBucketSize,
  isBackgroundBucketSizeCalculationEnabled,
  isBucketSizeResultFresh,
  trackBucketAccess,
} from "./bucket-size.js";
import { config } from "./config.js";
import { sentryCountMetric, sentryDistributionMetric } from "./observability.js";
import {
  createFolder,
  deleteObject,
  deletePrefix,
  getObject,
  getObjectMetadata,
  listBuckets,
  listObjects,
  uploadObject,
} from "./s3.js";
import type { AuditEvent } from "./audit/index.js";
import {
  getCachedListObjectsResponse,
  invalidateCachedListObjectsByPrefix,
  invalidateCachedListObjectsForBucket,
  setCachedListObjectsResponse,
} from "./session.js";

const listObjectsSchema = z.object({
  bucket: z.string().min(1),
  prefix: z.string().default(""),
  continuationToken: z.string().optional(),
  maxKeys: z.coerce.number().int().min(1).max(1000).default(200),
});

const bucketAndKeySchema = z.object({
  bucket: z.string().min(1),
  key: z.string().min(1),
});

const bucketAndKeyDownloadSchema = z.object({
  bucket: z.string().min(1),
  key: z.string().min(1),
  inline: z.enum(["0", "1"]).optional(),
});

const bucketAndPrefixSchema = z.object({
  bucket: z.string().min(1),
  prefix: z.string().min(1),
});

const createFolderSchema = z.object({
  bucket: z.string().min(1),
  prefix: z.string().default(""),
  name: z.string().min(1),
});

const bucketNameParamsSchema = z.object({
  bucketName: z.string().min(1),
});

const streamToBuffer = async (stream: Readable): Promise<Buffer> => {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
};

const buildAuditBase = (request: {
  sessionToken?: string;
  sessionCredentials?: { accessKeyId: string };
}) => {
  return {
    sessionToken: hashSessionToken(request.sessionToken),
    accessKeyHash: hashAccessKeyId(request.sessionCredentials?.accessKeyId),
  };
};

const recordS3Event = (
  request: { sessionToken?: string; sessionCredentials?: { accessKeyId: string } },
  event: AuditEvent,
) => {
  void recordAuditEvent({
    ...buildAuditBase(request),
    ...event,
  });
};

const setListCacheHeader = (reply: FastifyReply, value: "HIT" | "MISS" | "BYPASS"): void => {
  if (!config.S3_LIST_CACHE_INCLUDE_HEADERS) {
    return;
  }

  reply.header("X-Atrium-S3-List-Cache", value);
};

const normalizePrefix = (prefix: string): string => {
  if (!prefix) {
    return "";
  }

  return prefix.endsWith("/") ? prefix : `${prefix}/`;
};

const normalizeFolderName = (value: string): string => {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new AppError("Folder name is required.", 400, true);
  }

  if (trimmed === "." || trimmed === "..") {
    throw new AppError("Folder name cannot be . or ..", 400, true);
  }

  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new AppError("Folder name cannot contain / or backslash.", 400, true);
  }

  if (trimmed.length > 1024) {
    throw new AppError("Folder name is too long.", 400, true);
  }

  return trimmed;
};

const normalizeUploadPath = (value: string): string => {
  const normalized = value.replace(/\\+/g, "/").trim().replace(/^\/+/, "");

  if (!normalized) {
    throw new AppError("Upload path is required.", 400, true);
  }

  const segments = normalized
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (!segments.length) {
    throw new AppError("Upload path is required.", 400, true);
  }

  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      throw new AppError("Upload path contains invalid segments.", 400, true);
    }

    if (segment.includes("\u0000")) {
      throw new AppError("Upload path contains invalid characters.", 400, true);
    }
  }

  return segments.join("/");
};

const getRelativePathFieldValue = (file: { fields?: unknown }): string | undefined => {
  if (!file.fields || typeof file.fields !== "object") {
    return undefined;
  }

  const fields = file.fields as Record<string, unknown>;
  const field = fields.relativePath;

  if (Array.isArray(field) || !field || typeof field !== "object") {
    return undefined;
  }

  const value = (field as { value?: unknown }).value;
  return typeof value === "string" ? value : undefined;
};

const getParentPrefixFromObjectKey = (key: string): string => {
  const lastSlash = key.lastIndexOf("/");
  return lastSlash === -1 ? "" : key.slice(0, lastSlash + 1);
};

const getAncestorPrefixes = (prefix: string): string[] => {
  const normalized = normalizePrefix(prefix);

  if (!normalized) {
    return [""];
  }

  const parts = normalized.split("/").filter(Boolean);
  const prefixes = [""];
  let current = "";

  for (const part of parts) {
    current = `${current}${part}/`;
    prefixes.push(current);
  }

  return prefixes;
};

const invalidateListCacheForMutation = async (
  sessionToken: string | undefined,
  bucket: string,
  options: { type: "object"; key: string } | { type: "prefix"; prefix: string },
): Promise<void> => {
  if (!config.S3_LIST_CACHE_ENABLED || !sessionToken) {
    return;
  }

  const metricAttributes = {
    bucket,
    mode: config.S3_LIST_CACHE_INVALIDATION_MODE,
    mutation: options.type,
  };

  try {
    let deletedKeys = 0;

    if (config.S3_LIST_CACHE_INVALIDATION_MODE === "bucket") {
      deletedKeys = await invalidateCachedListObjectsForBucket(sessionToken, bucket);
    } else if (options.type === "object") {
      const parentPrefix = getParentPrefixFromObjectKey(options.key);
      deletedKeys = await invalidateCachedListObjectsByPrefix(
        sessionToken,
        bucket,
        getAncestorPrefixes(parentPrefix),
      );
    } else {
      const normalizedPrefix = normalizePrefix(options.prefix);
      deletedKeys = await invalidateCachedListObjectsByPrefix(
        sessionToken,
        bucket,
        getAncestorPrefixes(normalizedPrefix),
        normalizedPrefix ? [normalizedPrefix] : [],
      );
    }

    sentryCountMetric("cache.s3_list.invalidate.keys", deletedKeys, metricAttributes);
  } catch {
    sentryCountMetric("cache.s3_list.invalidate.errors", 1, metricAttributes);
  }
};

export const registerS3Routes = (app: FastifyInstance): void => {
  app.get("/api/s3/buckets", { preHandler: requireSession }, async (request) => {
    const startedAt = Date.now();

    try {
      const buckets = await listBuckets(request.sessionCredentials!);
      recordS3Event(request, {
        operation: "s3.list_buckets",
        result: "success",
        durationMs: Date.now() - startedAt,
      });
      return { buckets };
    } catch (error) {
      recordS3Event(request, {
        operation: "s3.list_buckets",
        result: "failure",
        error: toErrorMessage(error),
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  });

  app.get("/api/s3/objects", { preHandler: requireSession }, async (request, reply) => {
    const startedAt = Date.now();
    const parsed = listObjectsSchema.safeParse(request.query);

    if (!parsed.success) {
      recordS3Event(request, {
        operation: "s3.list_objects",
        result: "failure",
        error: "invalid_query",
        durationMs: Date.now() - startedAt,
      });
      throw new AppError("Invalid list object query params", 400, true);
    }

    const { bucket, prefix, continuationToken, maxKeys } = parsed.data;
    if (request.sessionToken) {
      void trackBucketAccess(request.sessionToken, bucket).catch((error) => {
        console.error("Failed to track bucket access", error);
      });
    }

    const metricAttributes = {
      bucket,
      is_root_prefix: prefix === "",
      max_keys: maxKeys,
      has_continuation_token: Boolean(continuationToken),
    };

    if (!config.S3_LIST_CACHE_ENABLED || !request.sessionToken) {
      setListCacheHeader(reply, "BYPASS");
      sentryCountMetric("cache.s3_list.bypass", 1, metricAttributes);

      try {
        const response = await listObjects(
          request.sessionCredentials!,
          bucket,
          prefix,
          continuationToken,
          maxKeys,
        );

        recordS3Event(request, {
          operation: "s3.list_objects",
          result: "success",
          bucket: parsed.data.bucket,
          prefix: parsed.data.prefix,
          durationMs: Date.now() - startedAt,
        });

        return response;
      } catch (error) {
        recordS3Event(request, {
          operation: "s3.list_objects",
          result: "failure",
          bucket: parsed.data.bucket,
          prefix: parsed.data.prefix,
          error: toErrorMessage(error),
          durationMs: Date.now() - startedAt,
        });
        throw error;
      }
    }

    const lookupStartedAt = Date.now();

    let cacheLookupError = false;
    try {
      const cachedResponse = await getCachedListObjectsResponse(
        request.sessionToken,
        bucket,
        prefix,
        continuationToken,
        maxKeys,
      );
      sentryDistributionMetric(
        "cache.s3_list.lookup.latency",
        Date.now() - lookupStartedAt,
        "millisecond",
        metricAttributes,
      );
      if (cachedResponse) {
        setListCacheHeader(reply, "HIT");
        sentryCountMetric("cache.s3_list.hit", 1, metricAttributes);
        return cachedResponse;
      }
    } catch {
      cacheLookupError = true;
      setListCacheHeader(reply, "BYPASS");
      sentryCountMetric("cache.s3_list.lookup.errors", 1, metricAttributes);
    }
    if (cacheLookupError) {
      // Do not set MISS or attempt store/metrics if cache is unavailable
      return listObjects(request.sessionCredentials!, bucket, prefix, continuationToken, maxKeys);
    }
    setListCacheHeader(reply, "MISS");
    sentryCountMetric("cache.s3_list.miss", 1, metricAttributes);
    const response = await listObjects(
      request.sessionCredentials!,
      bucket,
      prefix,
      continuationToken,
      maxKeys,
    );
    const storeStartedAt = Date.now();
    void setCachedListObjectsResponse(
      request.sessionToken,
      bucket,
      prefix,
      continuationToken,
      maxKeys,
      response,
    )
      .then(() => {
        sentryDistributionMetric(
          "cache.s3_list.store.latency",
          Date.now() - storeStartedAt,
          "millisecond",
          metricAttributes,
        );
      })
      .catch(() => {
        sentryCountMetric("cache.s3_list.store.errors", 1, metricAttributes);
      });
    return response;
  });

  app.get(
    "/api/s3/buckets/:bucketName/size",
    { preHandler: requireSession },
    async (request, reply) => {
      if (!(await isBackgroundBucketSizeCalculationEnabled())) {
        return reply.code(404).send({
          error: "Feature disabled",
        });
      }

      const parsed = bucketNameParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        throw new AppError("Invalid bucket name", 400, true);
      }

      if (request.sessionToken) {
        void trackBucketAccess(request.sessionToken, parsed.data.bucketName).catch((error) => {
          console.error("Failed to track bucket access", error);
        });
      }

      const cachedResult = await getCachedBucketSize(
        parsed.data.bucketName,
        request.sessionCredentials!.accessKeyId,
      );

      if (!cachedResult) {
        return reply.code(404).send({
          error: "Not calculated yet",
          message: "Bucket size will be calculated in the background",
        });
      }

      return {
        bucket: parsed.data.bucketName,
        totalSize: cachedResult.totalSize,
        sizeFormatted: cachedResult.sizeFormatted,
        objectCount: cachedResult.objectCount,
        isApproximate: cachedResult.isApproximate,
        isInaccessible: cachedResult.isInaccessible,
        error: cachedResult.error,
        calculatedAt: cachedResult.calculatedAt,
        ageMinutes: Math.floor((Date.now() - cachedResult.calculatedAt) / 60000),
        isStale: !isBucketSizeResultFresh(cachedResult),
      };
    },
  );

  app.post(
    "/api/s3/buckets/:bucketName/size/calculate",
    { preHandler: requireSession },
    async (request, reply) => {
      if (!(await isBackgroundBucketSizeCalculationEnabled())) {
        return reply.code(404).send({
          error: "Feature disabled",
        });
      }

      const parsed = bucketNameParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        throw new AppError("Invalid bucket name", 400, true);
      }

      if (request.sessionToken) {
        void trackBucketAccess(request.sessionToken, parsed.data.bucketName).catch((error) => {
          request.log.error(
            { error, bucket: parsed.data.bucketName },
            "Failed to track bucket access",
          );
        });
      }

      void calculateBucketSizeWithLock(
        parsed.data.bucketName,
        request.sessionCredentials!,
        request.log,
        { force: true },
      ).catch((error) => {
        request.log.error(
          { error, bucket: parsed.data.bucketName },
          "Manual size calculation failed",
        );
      });

      return reply.code(202).send({
        message: "Calculation started",
        bucket: parsed.data.bucketName,
      });
    },
  );

  app.post("/api/s3/upload", { preHandler: requireSession }, async (request) => {
    const startedAt = Date.now();
    const query = z
      .object({
        bucket: z.string().min(1),
        prefix: z.string().default(""),
      })
      .parse(request.query);

    const file = await request.file();

    if (!file) {
      recordS3Event(request, {
        operation: "s3.upload",
        result: "failure",
        bucket: query.bucket,
        prefix: query.prefix,
        error: "missing_file",
        durationMs: Date.now() - startedAt,
      });
      throw new AppError("No file uploaded", 400, true);
    }

    const buffer = await file.toBuffer();
    const normalizedPrefix = normalizePrefix(query.prefix);
    const fieldRelativePath = getRelativePathFieldValue(file);
    const normalizedRelativePath = normalizeUploadPath(fieldRelativePath ?? file.filename);
    const key = `${normalizedPrefix}${normalizedRelativePath}`;

    if (Buffer.byteLength(key, "utf8") > 1024) {
      throw new AppError("Upload path is too long.", 400, true);
    }

    try {
      await uploadObject(request.sessionCredentials!, query.bucket, key, buffer, file.mimetype);
      recordS3Event(request, {
        operation: "s3.upload",
        result: "success",
        bucket: query.bucket,
        key,
        durationMs: Date.now() - startedAt,
      });
      void invalidateListCacheForMutation(request.sessionToken, query.bucket, {
        type: "object",
        key,
      }).catch((error) => {
        console.error("Failed to invalidate S3 list cache after upload", error);
      });

      return { ok: true, key };
    } catch (error) {
      recordS3Event(request, {
        operation: "s3.upload",
        result: "failure",
        bucket: query.bucket,
        key,
        error: toErrorMessage(error),
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  });

  app.post("/api/s3/folder", { preHandler: requireSession }, async (request) => {
    const startedAt = Date.now();
    const parsed = createFolderSchema.safeParse(request.body);

    if (!parsed.success) {
      recordS3Event(request, {
        operation: "s3.create_folder",
        result: "failure",
        error: "invalid_body",
        durationMs: Date.now() - startedAt,
      });
      throw new AppError("Invalid create folder payload", 400, true);
    }

    const name = normalizeFolderName(parsed.data.name);
    const normalizedPrefix = normalizePrefix(parsed.data.prefix);
    const folderKey = `${normalizedPrefix}${name}/`;

    if (Buffer.byteLength(folderKey, "utf8") > 1024) {
      throw new AppError("Folder path is too long.", 400, true);
    }

    try {
      const result = await createFolder(request.sessionCredentials!, parsed.data.bucket, folderKey);
      recordS3Event(request, {
        operation: "s3.create_folder",
        result: "success",
        bucket: parsed.data.bucket,
        key: folderKey,
        durationMs: Date.now() - startedAt,
      });

      void invalidateListCacheForMutation(request.sessionToken, parsed.data.bucket, {
        type: "object",
        key: folderKey,
      }).catch((error) => {
        console.error("Failed to invalidate S3 list cache after create folder", error);
      });

      return { ok: true, key: result.key, placeholderCreated: result.usedPlaceholder };
    } catch (error) {
      recordS3Event(request, {
        operation: "s3.create_folder",
        result: "failure",
        bucket: parsed.data.bucket,
        key: folderKey,
        error: toErrorMessage(error),
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  });

  app.get("/api/s3/download", { preHandler: requireSession }, async (request, reply) => {
    const startedAt = Date.now();
    const parsed = bucketAndKeyDownloadSchema.safeParse(request.query);

    if (!parsed.success) {
      recordS3Event(request, {
        operation: "s3.download",
        result: "failure",
        error: "invalid_query",
        durationMs: Date.now() - startedAt,
      });
      throw new AppError("Invalid download query params", 400, true);
    }

    try {
      const response = await getObject(
        request.sessionCredentials!,
        parsed.data.bucket,
        parsed.data.key,
      );

      if (!response.Body) {
        throw new AppError("Object has no body", 404, true);
      }

      const filename = parsed.data.key.split("/").pop() || parsed.data.key;

      reply.header("Content-Type", response.ContentType || "application/octet-stream");
      if (parsed.data.inline === "1") {
        reply.header("Content-Disposition", `inline; filename="${filename}"`);
      } else {
        reply.header("Content-Disposition", `attachment; filename="${filename}"`);
      }

      recordS3Event(request, {
        operation: "s3.download",
        result: "success",
        bucket: parsed.data.bucket,
        key: parsed.data.key,
        durationMs: Date.now() - startedAt,
      });

      return reply.send(response.Body as Readable);
    } catch (error) {
      recordS3Event(request, {
        operation: "s3.download",
        result: "failure",
        bucket: parsed.data.bucket,
        key: parsed.data.key,
        error: toErrorMessage(error),
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  });

  app.get("/api/s3/preview-text", { preHandler: requireSession }, async (request, reply) => {
    const startedAt = Date.now();
    const parsed = bucketAndKeySchema.safeParse(request.query);

    if (!parsed.success) {
      recordS3Event(request, {
        operation: "s3.preview_text",
        result: "failure",
        error: "invalid_query",
        durationMs: Date.now() - startedAt,
      });
      throw new AppError("Invalid preview query params", 400, true);
    }

    try {
      const response = await getObject(
        request.sessionCredentials!,
        parsed.data.bucket,
        parsed.data.key,
      );

      if (!response.Body) {
        throw new AppError("Object has no body", 404, true);
      }

      let content = "";

      if ("transformToByteArray" in (response.Body as object)) {
        const bytes = await (
          response.Body as { transformToByteArray(): Promise<Uint8Array> }
        ).transformToByteArray();
        content = Buffer.from(bytes).toString("utf-8");
      } else {
        content = (await streamToBuffer(response.Body as Readable)).toString("utf-8");
      }

      reply.header("Content-Type", "text/plain; charset=utf-8");

      recordS3Event(request, {
        operation: "s3.preview_text",
        result: "success",
        bucket: parsed.data.bucket,
        key: parsed.data.key,
        durationMs: Date.now() - startedAt,
      });

      return reply.send(content.slice(0, 1_000_000));
    } catch (error) {
      recordS3Event(request, {
        operation: "s3.preview_text",
        result: "failure",
        bucket: parsed.data.bucket,
        key: parsed.data.key,
        error: toErrorMessage(error),
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  });

  app.get("/api/s3/object-metadata", { preHandler: requireSession }, async (request) => {
    const startedAt = Date.now();
    const parsed = bucketAndKeySchema.safeParse(request.query);

    if (!parsed.success) {
      recordS3Event(request, {
        operation: "s3.object_metadata",
        result: "failure",
        error: "invalid_query",
        durationMs: Date.now() - startedAt,
      });
      throw new AppError("Invalid metadata query params", 400, true);
    }

    try {
      const response = await getObjectMetadata(
        request.sessionCredentials!,
        parsed.data.bucket,
        parsed.data.key,
      );
      recordS3Event(request, {
        operation: "s3.object_metadata",
        result: "success",
        bucket: parsed.data.bucket,
        key: parsed.data.key,
        durationMs: Date.now() - startedAt,
      });
      return response;
    } catch (error) {
      recordS3Event(request, {
        operation: "s3.object_metadata",
        result: "failure",
        bucket: parsed.data.bucket,
        key: parsed.data.key,
        error: toErrorMessage(error),
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  });

  app.delete("/api/s3/object", { preHandler: requireSession }, async (request) => {
    const startedAt = Date.now();
    const parsed = bucketAndKeySchema.safeParse(request.query);

    if (!parsed.success) {
      recordS3Event(request, {
        operation: "s3.delete_object",
        result: "failure",
        error: "invalid_query",
        durationMs: Date.now() - startedAt,
      });
      throw new AppError("Invalid delete object query params", 400, true);
    }

    try {
      await deleteObject(request.sessionCredentials!, parsed.data.bucket, parsed.data.key);
      recordS3Event(request, {
        operation: "s3.delete_object",
        result: "success",
        bucket: parsed.data.bucket,
        key: parsed.data.key,
        durationMs: Date.now() - startedAt,
      });

      void invalidateListCacheForMutation(request.sessionToken, parsed.data.bucket, {
        type: "object",
        key: parsed.data.key,
      }).catch((error) => {
        console.error("Failed to invalidate S3 list cache after delete object", error);
      });
      return { ok: true };
    } catch (error) {
      recordS3Event(request, {
        operation: "s3.delete_object",
        result: "failure",
        bucket: parsed.data.bucket,
        key: parsed.data.key,
        error: toErrorMessage(error),
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  });

  app.delete("/api/s3/prefix", { preHandler: requireSession }, async (request) => {
    const startedAt = Date.now();
    const parsed = bucketAndPrefixSchema.safeParse(request.query);

    if (!parsed.success) {
      recordS3Event(request, {
        operation: "s3.delete_prefix",
        result: "failure",
        error: "invalid_query",
        durationMs: Date.now() - startedAt,
      });
      throw new AppError("Invalid delete prefix query params", 400, true);
    }

    try {
      const deleted = await deletePrefix(
        request.sessionCredentials!,
        parsed.data.bucket,
        parsed.data.prefix,
      );
      recordS3Event(request, {
        operation: "s3.delete_prefix",
        result: "success",
        bucket: parsed.data.bucket,
        prefix: parsed.data.prefix,
        durationMs: Date.now() - startedAt,
      });

      void invalidateListCacheForMutation(request.sessionToken, parsed.data.bucket, {
        type: "prefix",
        prefix: parsed.data.prefix,
      }).catch((error) => {
        console.error("Failed to invalidate S3 list cache after delete prefix", error);
      });

      return { ok: true, deleted };
    } catch (error) {
      recordS3Event(request, {
        operation: "s3.delete_prefix",
        result: "failure",
        bucket: parsed.data.bucket,
        prefix: parsed.data.prefix,
        error: toErrorMessage(error),
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  });
};
