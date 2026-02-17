import { describe, it, expect } from "vitest";
import { config, cookieConfig } from "../src/server/config.js";

describe("config", () => {
  describe("config values", () => {
    it("should have required Redis URL", () => {
      expect(config.REDIS_URL).toBeDefined();
      expect(typeof config.REDIS_URL).toBe("string");
    });

    it("should have required S3 configuration", () => {
      expect(config.S3_ENDPOINT).toBeDefined();
      expect(config.S3_REGION).toBeDefined();
      expect(typeof config.S3_ENDPOINT).toBe("string");
      expect(typeof config.S3_REGION).toBe("string");
    });

    it("should have default values", () => {
      expect(config.SESSION_TTL_SECONDS).toBe(86400);
      expect(config.COOKIE_NAME).toBe("atrium_session");
      expect(config.MAX_UPLOAD_SIZE_MB).toBe(100);
    });

    it("should have valid NODE_ENV", () => {
      expect(["development", "production", "test"]).toContain(config.NODE_ENV);
    });

    it("should have boolean S3_FORCE_PATH_STYLE", () => {
      expect(typeof config.S3_FORCE_PATH_STYLE).toBe("boolean");
    });

    it("should have valid S3_LIST_CACHE_INVALIDATION_MODE", () => {
      expect(["targeted", "bucket"]).toContain(config.S3_LIST_CACHE_INVALIDATION_MODE);
    });

    it("should have valid AUDIT_LOG_SINK", () => {
      expect(["filesystem", "loki", "none"]).toContain(config.AUDIT_LOG_SINK);
    });
  });

  describe("cookieConfig", () => {
    it("should have correct cookie defaults", () => {
      expect(cookieConfig.httpOnly).toBe(true);
      expect(cookieConfig.sameSite).toBe("lax");
      expect(cookieConfig.path).toBe("/");
    });

    it("should have valid secure flag based on NODE_ENV", () => {
      expect(typeof cookieConfig.secure).toBe("boolean");
      if (config.NODE_ENV === "production") {
        expect(cookieConfig.secure).toBe(true);
      } else {
        expect(cookieConfig.secure).toBe(false);
      }
    });

    it("should have maxAge matching SESSION_TTL_SECONDS", () => {
      expect(cookieConfig.maxAge).toBe(config.SESSION_TTL_SECONDS);
    });
  });
});
