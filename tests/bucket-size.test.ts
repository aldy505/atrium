import { describe, expect, it } from "vitest";
import {
  getBucketSizeCacheTtlSeconds,
  isBucketSizeResultFresh,
  type BucketSizeResult,
} from "../src/server/bucket-size.js";

describe("bucket size helpers", () => {
  it("should use adaptive cache TTL based on object count", () => {
    expect(getBucketSizeCacheTtlSeconds(100)).toBe(3600);
    expect(getBucketSizeCacheTtlSeconds(15000)).toBe(86400);
    expect(getBucketSizeCacheTtlSeconds(250000)).toBe(604800);
  });

  it("should mark small buckets stale after one hour", () => {
    const now = Date.now();
    const result: BucketSizeResult = {
      bucket: "small",
      totalSize: 100,
      objectCount: 9999,
      isApproximate: false,
      isInaccessible: false,
      calculatedAt: now - 2 * 60 * 60 * 1000,
      durationMs: 10,
      sizeFormatted: "100 Bytes",
    };

    expect(isBucketSizeResultFresh(result, now)).toBe(false);
  });

  it("should keep medium buckets fresh for up to one day", () => {
    const now = Date.now();
    const result: BucketSizeResult = {
      bucket: "medium",
      totalSize: 100,
      objectCount: 50000,
      isApproximate: false,
      isInaccessible: false,
      calculatedAt: now - 2 * 60 * 60 * 1000,
      durationMs: 10,
      sizeFormatted: "100 Bytes",
    };

    expect(isBucketSizeResultFresh(result, now)).toBe(true);
  });
});
