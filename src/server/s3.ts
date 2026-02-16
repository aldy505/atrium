import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { lookup as lookupMimeType } from "mime-types";
import { config } from "./config.js";
import { sentryDistributionMetric, sentryGaugeMetric } from "./observability.js";
import type { ListObjectsResponse, ObjectMetadataResponse, SessionCredentials } from "./types.js";

let uploadFilesInFlight = 0;
let downloadFilesInFlight = 0;

const trackS3Latency = async <T>(
  operation: string,
  run: () => Promise<T>,
  attributes?: Record<string, unknown>,
): Promise<T> => {
  const startedAt = Date.now();

  try {
    const result = await run();
    sentryDistributionMetric(`s3.${operation}.latency`, Date.now() - startedAt, "millisecond", {
      ...attributes,
      status: "success",
    });
    return result;
  } catch (error) {
    sentryDistributionMetric(`s3.${operation}.latency`, Date.now() - startedAt, "millisecond", {
      ...attributes,
      status: "failure",
    });
    throw error;
  }
};

const reportTransferGauges = (attributes?: Record<string, unknown>): void => {
  sentryGaugeMetric("s3.upload.files_in_flight", uploadFilesInFlight, attributes);
  sentryGaugeMetric("s3.download.files_in_flight", downloadFilesInFlight, attributes);
};

const inferContentType = (key: string): string => {
  return (lookupMimeType(key) || "application/octet-stream") as string;
};

const isHeadObjectUnsupported = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    name?: string;
    Code?: string;
    code?: string;
    $metadata?: {
      httpStatusCode?: number;
    };
  };

  const code = candidate.Code || candidate.code || candidate.name;
  const statusCode = candidate.$metadata?.httpStatusCode;

  if (code === "NotImplemented" || code === "MethodNotAllowed") {
    return true;
  }

  return statusCode === 405 || statusCode === 501;
};

const getS3Client = (credentials: SessionCredentials): S3Client => {
  return new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials,
  });
};

export const validateCredentials = async (credentials: SessionCredentials): Promise<void> => {
  const client = getS3Client(credentials);
  await trackS3Latency("list_buckets", () => client.send(new ListBucketsCommand({})));
};

export const listBuckets = async (credentials: SessionCredentials): Promise<string[]> => {
  const client = getS3Client(credentials);
  const response = await trackS3Latency("list_buckets", () =>
    client.send(new ListBucketsCommand({})),
  );
  return (response.Buckets ?? []).map((bucket) => bucket.Name ?? "").filter(Boolean);
};

export const listObjects = async (
  credentials: SessionCredentials,
  bucket: string,
  prefix: string,
  continuationToken?: string,
  maxKeys = 200,
): Promise<ListObjectsResponse> => {
  const client = getS3Client(credentials);

  const response = await trackS3Latency(
    "list_objects_v2",
    () =>
      client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          Delimiter: "/",
          ContinuationToken: continuationToken,
          MaxKeys: maxKeys,
        }),
      ),
    {
      bucket,
    },
  );

  const folders = (response.CommonPrefixes ?? [])
    .map((entry) => entry.Prefix)
    .filter(Boolean)
    .map((value) => ({
      type: "folder" as const,
      key: value!,
      name: value!.slice(prefix.length).replace(/\/$/, ""),
    }));

  const files = (response.Contents ?? [])
    .filter((item) => item.Key && item.Key !== prefix)
    .map((item) => {
      const key = item.Key as string;
      return {
        type: "file" as const,
        key,
        name: key.slice(prefix.length),
        size: item.Size ?? 0,
        lastModified: item.LastModified?.toISOString(),
        contentType: inferContentType(key),
      };
    });

  return {
    bucket,
    prefix,
    continuationToken,
    nextContinuationToken: response.NextContinuationToken,
    isTruncated: Boolean(response.IsTruncated),
    folders,
    files,
  };
};

export const uploadObject = async (
  credentials: SessionCredentials,
  bucket: string,
  key: string,
  body: Buffer,
  contentType?: string,
): Promise<void> => {
  const client = getS3Client(credentials);
  uploadFilesInFlight += 1;
  reportTransferGauges({ bucket });

  try {
    await trackS3Latency(
      "put_object",
      () =>
        client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: contentType || inferContentType(key),
          }),
        ),
      {
        bucket,
        file_size_bytes: body.length,
      },
    );
  } finally {
    uploadFilesInFlight = Math.max(0, uploadFilesInFlight - 1);
    reportTransferGauges({ bucket });
  }
};

export const getObject = async (credentials: SessionCredentials, bucket: string, key: string) => {
  const client = getS3Client(credentials);
  downloadFilesInFlight += 1;
  reportTransferGauges({ bucket });

  try {
    const response = await trackS3Latency(
      "get_object",
      () =>
        client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: key,
          }),
        ),
      {
        bucket,
      },
    );

    const body = response.Body as { once?: (event: string, handler: () => void) => void };

    if (body && typeof body.once === "function") {
      let finalized = false;

      const finalize = () => {
        if (finalized) {
          return;
        }

        finalized = true;
        downloadFilesInFlight = Math.max(0, downloadFilesInFlight - 1);
        reportTransferGauges({ bucket });
      };

      body.once("end", finalize);
      body.once("close", finalize);
      body.once("error", finalize);
      return response;
    }

    downloadFilesInFlight = Math.max(0, downloadFilesInFlight - 1);
    reportTransferGauges({ bucket });
    return response;
  } catch (error) {
    downloadFilesInFlight = Math.max(0, downloadFilesInFlight - 1);
    reportTransferGauges({ bucket });
    throw error;
  }
};

export const getObjectMetadata = async (
  credentials: SessionCredentials,
  bucket: string,
  key: string,
): Promise<ObjectMetadataResponse> => {
  const client = getS3Client(credentials);

  try {
    const response = await trackS3Latency(
      "head_object",
      () =>
        client.send(
          new HeadObjectCommand({
            Bucket: bucket,
            Key: key,
          }),
        ),
      {
        bucket,
      },
    );

    return {
      bucket,
      key,
      size: response.ContentLength,
      lastModified: response.LastModified?.toISOString(),
      contentType: response.ContentType || inferContentType(key),
    };
  } catch (error) {
    if (!isHeadObjectUnsupported(error)) {
      throw error;
    }

    return {
      bucket,
      key,
      contentType: inferContentType(key),
    };
  }
};

export const deleteObject = async (
  credentials: SessionCredentials,
  bucket: string,
  key: string,
): Promise<void> => {
  const client = getS3Client(credentials);
  await trackS3Latency(
    "delete_object",
    () =>
      client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      ),
    {
      bucket,
    },
  );
};

export const deletePrefix = async (
  credentials: SessionCredentials,
  bucket: string,
  prefix: string,
): Promise<number> => {
  const client = getS3Client(credentials);

  let continuationToken: string | undefined;
  let deletedCount = 0;

  do {
    // List in pages and delete object-by-object to stay compatible with providers
    // that vary in batch delete feature behavior.
    const listResponse = await trackS3Latency(
      "list_objects_v2",
      () =>
        client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          }),
        ),
      {
        bucket,
      },
    );

    const keys = (listResponse.Contents ?? []).map((item) => item.Key).filter(Boolean) as string[];

    for (const key of keys) {
      await trackS3Latency(
        "delete_object",
        () =>
          client.send(
            new DeleteObjectCommand({
              Bucket: bucket,
              Key: key,
            }),
          ),
        {
          bucket,
        },
      );
      deletedCount += 1;
    }

    continuationToken = listResponse.NextContinuationToken;
  } while (continuationToken);

  return deletedCount;
};
