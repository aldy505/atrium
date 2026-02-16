import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { AppError } from "./errors.js";
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
    return { buckets: await listBuckets(request.sessionCredentials!) };
  });

  app.get("/api/s3/objects", { preHandler: requireSession }, async (request, reply) => {
    const parsed = listObjectsSchema.safeParse(request.query);

    if (!parsed.success) {
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

      return listObjects(request.sessionCredentials!, bucket, prefix, continuationToken, maxKeys);
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
    try {
      await setCachedListObjectsResponse(
        request.sessionToken,
        bucket,
        prefix,
        continuationToken,
        maxKeys,
        response,
      );
      sentryDistributionMetric(
        "cache.s3_list.store.latency",
        Date.now() - storeStartedAt,
        "millisecond",
        metricAttributes,
      );
    } catch {
      sentryCountMetric("cache.s3_list.store.errors", 1, metricAttributes);
    }
    return response;
  });

  app.post("/api/s3/upload", { preHandler: requireSession }, async (request) => {
    const query = z
      .object({
        bucket: z.string().min(1),
        prefix: z.string().default(""),
      })
      .parse(request.query);

    const file = await request.file();

    if (!file) {
      throw new AppError("No file uploaded", 400, true);
    }

    const buffer = await file.toBuffer();
    const key = `${query.prefix}${file.filename}`;

    await uploadObject(request.sessionCredentials!, query.bucket, key, buffer, file.mimetype);
    await invalidateListCacheForMutation(request.sessionToken, query.bucket, {
      type: "object",
      key,
    });

    return { ok: true, key };
  });

  app.get("/api/s3/download", { preHandler: requireSession }, async (request, reply) => {
    const parsed = bucketAndKeyDownloadSchema.safeParse(request.query);

    if (!parsed.success) {
      throw new AppError("Invalid download query params", 400, true);
    }

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

    return reply.send(response.Body as Readable);
  });

  app.get("/api/s3/preview-text", { preHandler: requireSession }, async (request, reply) => {
    const parsed = bucketAndKeySchema.safeParse(request.query);

    if (!parsed.success) {
      throw new AppError("Invalid preview query params", 400, true);
    }

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
    return reply.send(content.slice(0, 1_000_000));
  });

  app.get("/api/s3/object-metadata", { preHandler: requireSession }, async (request) => {
    const parsed = bucketAndKeySchema.safeParse(request.query);

    if (!parsed.success) {
      throw new AppError("Invalid metadata query params", 400, true);
    }

    return getObjectMetadata(request.sessionCredentials!, parsed.data.bucket, parsed.data.key);
  });

  app.delete("/api/s3/object", { preHandler: requireSession }, async (request) => {
    const parsed = bucketAndKeySchema.safeParse(request.query);

    if (!parsed.success) {
      throw new AppError("Invalid delete object query params", 400, true);
    }

    await deleteObject(request.sessionCredentials!, parsed.data.bucket, parsed.data.key);
    await invalidateListCacheForMutation(request.sessionToken, parsed.data.bucket, {
      type: "object",
      key: parsed.data.key,
    });
    return { ok: true };
  });

  app.delete("/api/s3/prefix", { preHandler: requireSession }, async (request) => {
    const parsed = bucketAndPrefixSchema.safeParse(request.query);

    if (!parsed.success) {
      throw new AppError("Invalid delete prefix query params", 400, true);
    }

    const deleted = await deletePrefix(
      request.sessionCredentials!,
      parsed.data.bucket,
      parsed.data.prefix,
    );
    await invalidateListCacheForMutation(request.sessionToken, parsed.data.bucket, {
      type: "prefix",
      prefix: parsed.data.prefix,
    });
    return { ok: true, deleted };
  });
};
