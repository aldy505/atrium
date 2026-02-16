import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hashAccessKeyId, hashSessionToken, recordAuditEvent } from "./audit/index.js";
import { AppError, toErrorMessage } from "./errors.js";
import { requireSession } from "./auth.js";
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

  app.get("/api/s3/objects", { preHandler: requireSession }, async (request) => {
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

    try {
      const response = await listObjects(
        request.sessionCredentials!,
        parsed.data.bucket,
        parsed.data.prefix,
        parsed.data.continuationToken,
        parsed.data.maxKeys,
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
