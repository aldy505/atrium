import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { lookup as lookupMimeType } from "mime-types";
import { config } from "./config.js";
import type { ListObjectsResponse, SessionCredentials } from "./types.js";

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
  await client.send(new ListBucketsCommand({}));
};

export const listBuckets = async (credentials: SessionCredentials): Promise<string[]> => {
  const client = getS3Client(credentials);
  const response = await client.send(new ListBucketsCommand({}));
  return (response.Buckets ?? []).map((bucket) => bucket.Name ?? "").filter(Boolean);
};

export const listObjects = async (
  credentials: SessionCredentials,
  bucket: string,
  prefix: string,
): Promise<ListObjectsResponse> => {
  const client = getS3Client(credentials);

  const response = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      Delimiter: "/",
    }),
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
        contentType: (lookupMimeType(key) || "application/octet-stream") as string,
      };
    });

  return {
    bucket,
    prefix,
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

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType || (lookupMimeType(key) || "application/octet-stream").toString(),
    }),
  );
};

export const getObject = async (credentials: SessionCredentials, bucket: string, key: string) => {
  const client = getS3Client(credentials);
  return client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );
};

export const deleteObject = async (
  credentials: SessionCredentials,
  bucket: string,
  key: string,
): Promise<void> => {
  const client = getS3Client(credentials);
  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
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
    const listResponse = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    const keys = (listResponse.Contents ?? []).map((item) => item.Key).filter(Boolean) as string[];

    for (const key of keys) {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );
      deletedCount += 1;
    }

    continuationToken = listResponse.NextContinuationToken;
  } while (continuationToken);

  return deletedCount;
};
