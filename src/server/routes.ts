import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { hashAccessKeyId, hashSessionToken, recordAuditEvent } from "./audit/index.js";
import { AppError, toErrorMessage } from "./errors.js";
import { requireSession } from "./auth.js";
import { config } from "./config.js";
import { sentryCountMetric, sentryDistributionMetric } from "./observability.js";
import {
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
    const key = `${query.prefix}${file.filename}`;

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
