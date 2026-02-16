import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "./errors.js";
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

export const registerS3Routes = (app: FastifyInstance): void => {
  app.get("/api/s3/buckets", { preHandler: requireSession }, async (request) => {
    return { buckets: await listBuckets(request.sessionCredentials!) };
  });

  app.get("/api/s3/objects", { preHandler: requireSession }, async (request) => {
    const parsed = listObjectsSchema.safeParse(request.query);

    if (!parsed.success) {
      throw new AppError("Invalid list object query params", 400, true);
    }

    return listObjects(
      request.sessionCredentials!,
      parsed.data.bucket,
      parsed.data.prefix,
      parsed.data.continuationToken,
      parsed.data.maxKeys,
    );
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
    return { ok: true, deleted };
  });
};
