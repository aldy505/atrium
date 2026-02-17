import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { CreateBucketCommand, DeleteBucketCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  validateCredentials,
  listBuckets,
  listObjects,
  getObjectMetadata,
  uploadObject,
  getObject,
  deleteObject,
} from "../src/server/s3.js";
import { createTestS3Client, TEST_CREDENTIALS, TEST_BUCKET } from "./test-utils.js";
import type { SessionCredentials } from "../src/server/types.js";

describe("s3", () => {
  const s3Client = createTestS3Client();
  const testBucketName = `${TEST_BUCKET}-${Date.now()}`;

  beforeAll(async () => {
    // Create test bucket
    try {
      await s3Client.send(new CreateBucketCommand({ Bucket: testBucketName }));
    } catch (error) {
      console.warn("Failed to create test bucket:", error);
    }
  });

  afterAll(async () => {
    // Clean up test bucket
    try {
      await s3Client.send(new DeleteBucketCommand({ Bucket: testBucketName }));
    } catch (error) {
      console.warn("Failed to clean up test bucket:", error);
    } finally {
      s3Client.destroy();
    }
  });

  describe("validateCredentials", () => {
    it("should validate correct credentials", async () => {
      await expect(validateCredentials(TEST_CREDENTIALS)).resolves.not.toThrow();
    });

    it("should reject invalid credentials", async () => {
      const invalidCredentials: SessionCredentials = {
        accessKeyId: "invalid",
        secretAccessKey: "invalid",
      };

      await expect(validateCredentials(invalidCredentials)).rejects.toThrow();
    });
  });

  describe("listBuckets", () => {
    it("should list available buckets", async () => {
      const buckets = await listBuckets(TEST_CREDENTIALS);

      expect(Array.isArray(buckets)).toBe(true);
      expect(buckets.length).toBeGreaterThanOrEqual(0);
    });

    it("should return bucket names as strings", async () => {
      const buckets = await listBuckets(TEST_CREDENTIALS);

      buckets.forEach((bucket) => {
        expect(typeof bucket).toBe("string");
        expect(bucket.length).toBeGreaterThan(0);
      });
    });
  });

  describe("listObjects", () => {
    beforeAll(async () => {
      // Upload some test files
      try {
        await s3Client.send(
          new PutObjectCommand({
            Bucket: testBucketName,
            Key: "test-file-1.txt",
            Body: "Test content 1",
          }),
        );
        await s3Client.send(
          new PutObjectCommand({
            Bucket: testBucketName,
            Key: "folder/test-file-2.txt",
            Body: "Test content 2",
          }),
        );
      } catch (error) {
        console.warn("Failed to upload test files:", error);
      }
    });

    it("should list objects in a bucket", async () => {
      const result = await listObjects(TEST_CREDENTIALS, testBucketName, "", undefined, 100);

      expect(result).toBeDefined();
      expect(result.bucket).toBe(testBucketName);
      expect(result.prefix).toBe("");
      expect(Array.isArray(result.files)).toBe(true);
      expect(Array.isArray(result.folders)).toBe(true);
    });

    it("should filter objects by prefix", async () => {
      const result = await listObjects(TEST_CREDENTIALS, testBucketName, "folder/", undefined, 100);

      expect(result.prefix).toBe("folder/");
      result.files.forEach((file) => {
        expect(file.key.startsWith("folder/")).toBe(true);
      });
    });

    it("should separate files and folders", async () => {
      const result = await listObjects(TEST_CREDENTIALS, testBucketName, "", undefined, 100);

      const { files, folders } = result;

      files.forEach((file) => {
        expect(file.type).toBe("file");
        expect(file).toHaveProperty("size");
        expect(file).toHaveProperty("name");
        expect(file).toHaveProperty("key");
      });

      folders.forEach((folder) => {
        expect(folder.type).toBe("folder");
        expect(folder.key.endsWith("/")).toBe(true);
      });
    });

    it("should handle pagination", async () => {
      const result = await listObjects(TEST_CREDENTIALS, testBucketName, "", undefined, 1);

      expect(result.isTruncated).toBeDefined();
      if (result.isTruncated) {
        expect(result.nextContinuationToken).toBeDefined();
      }
    });

    it("should infer content types correctly", async () => {
      const result = await listObjects(TEST_CREDENTIALS, testBucketName, "", undefined, 100);

      const txtFiles = result.files.filter((file) => file.key.endsWith(".txt"));

      txtFiles.forEach((file) => {
        expect(file.contentType).toBe("text/plain");
      });
    });
  });

  describe("getObjectMetadata", () => {
    it("should get metadata for existing object", async () => {
      const metadata = await getObjectMetadata(TEST_CREDENTIALS, testBucketName, "test-file-1.txt");

      expect(metadata).toBeDefined();
      expect(metadata.key).toBe("test-file-1.txt");
      expect(metadata.size).toBeGreaterThan(0);
      expect(metadata.lastModified).toBeDefined();
      expect(metadata.contentType).toBeDefined();
    });

    it("should throw for non-existent object", async () => {
      await expect(
        getObjectMetadata(TEST_CREDENTIALS, testBucketName, "non-existent.txt"),
      ).rejects.toThrow();
    });
  });

  describe("uploadObject", () => {
    it("should upload a file", async () => {
      const content = Buffer.from("Upload test content");
      const key = "upload-test.txt";

      await expect(
        uploadObject(TEST_CREDENTIALS, testBucketName, key, content, "text/plain"),
      ).resolves.not.toThrow();

      // Verify file was uploaded
      const metadata = await getObjectMetadata(TEST_CREDENTIALS, testBucketName, key);
      expect(metadata.key).toBe(key);
    });

    it("should handle different content types", async () => {
      const content = Buffer.from('{"test": true}');
      const key = "test.json";

      await uploadObject(TEST_CREDENTIALS, testBucketName, key, content, "application/json");

      const metadata = await getObjectMetadata(TEST_CREDENTIALS, testBucketName, key);
      expect(metadata.contentType).toBe("application/json");
    });
  });

  describe("getObject", () => {
    beforeAll(async () => {
      // Upload a test file for downloading
      await s3Client.send(
        new PutObjectCommand({
          Bucket: testBucketName,
          Key: "download-test.txt",
          Body: "Download test content",
        }),
      );
    });

    it("should get an existing file", async () => {
      const result = await getObject(TEST_CREDENTIALS, testBucketName, "download-test.txt");

      expect(result).toBeDefined();
      expect(result.Body).toBeDefined();
      expect(result.ContentType).toBeDefined();
    });

    it("should throw for non-existent file", async () => {
      await expect(
        getObject(TEST_CREDENTIALS, testBucketName, "non-existent-download.txt"),
      ).rejects.toThrow();
    });
  });

  describe("deleteObject", () => {
    beforeAll(async () => {
      // Upload a test file for deletion
      await s3Client.send(
        new PutObjectCommand({
          Bucket: testBucketName,
          Key: "delete-test.txt",
          Body: "Delete test content",
        }),
      );
    });

    it("should delete an existing object", async () => {
      await expect(
        deleteObject(TEST_CREDENTIALS, testBucketName, "delete-test.txt"),
      ).resolves.not.toThrow();

      // Verify file was deleted
      await expect(
        getObjectMetadata(TEST_CREDENTIALS, testBucketName, "delete-test.txt"),
      ).rejects.toThrow();
    });

    it("should not throw when deleting non-existent object", async () => {
      await expect(
        deleteObject(TEST_CREDENTIALS, testBucketName, "non-existent.txt"),
      ).resolves.not.toThrow();
    });
  });
});
