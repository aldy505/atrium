import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { registerAuthRoutes, requireSession } from "../src/server/auth.js";
import { createSession, getSessionCredentials } from "../src/server/session.js";
import { validateCredentials } from "../src/server/s3.js";
import { createTestRedisClient, cleanupRedisKeys, TEST_CREDENTIALS } from "./test-utils.js";
import { config } from "../src/server/config.js";

// Mock the s3 validateCredentials function
vi.mock("../src/server/s3.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/server/s3.js")>();
  return {
    ...mod,
    validateCredentials: vi.fn(),
  };
});

// Mock audit functions
vi.mock("../src/server/audit/index.js", () => ({
  recordAuditEvent: vi.fn(),
  hashAccessKeyId: vi.fn((id: string) => `hash_${id}`),
  hashSessionToken: vi.fn((token: string) => `hash_${token}`),
}));

// Mock observability functions
vi.mock("../src/server/observability.js", () => ({
  recordAuthResultGauge: vi.fn(),
}));

describe("auth", () => {
  const redis = createTestRedisClient();

  beforeEach(async () => {
    await cleanupRedisKeys(redis, "session:*");
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await cleanupRedisKeys(redis, "session:*");
  });

  afterAll(async () => {
    await redis.disconnect();
  });

  describe("requireSession", () => {
    it("should throw 401 if cookie is missing", async () => {
      const app = Fastify();
      await app.register(cookie);

      const request = {
        cookies: {},
      } as any;

      const reply = {
        clearCookie: vi.fn(),
      } as any;

      await expect(requireSession(request, reply)).rejects.toThrow("Not authenticated");
    });

    it("should throw 401 if session is expired", async () => {
      const app = Fastify();
      await app.register(cookie);

      const request = {
        cookies: {
          [config.COOKIE_NAME]: "invalid-token",
        },
      } as any;

      const reply = {
        clearCookie: vi.fn(),
      } as any;

      await expect(requireSession(request, reply)).rejects.toThrow(
        "Session expired. Please log in again.",
      );
      expect(reply.clearCookie).toHaveBeenCalledWith(config.COOKIE_NAME, { path: "/" });
    });

    it("should set sessionToken and sessionCredentials on request for valid session", async () => {
      const token = await createSession(TEST_CREDENTIALS);

      const request = {
        cookies: {
          [config.COOKIE_NAME]: token,
        },
      } as any;

      const reply = {
        clearCookie: vi.fn(),
      } as any;

      await requireSession(request, reply);

      expect(request.sessionToken).toBe(token);
      expect(request.sessionCredentials).toBeDefined();
      expect(request.sessionCredentials.accessKeyId).toBe(TEST_CREDENTIALS.accessKeyId);
    });
  });

  describe("POST /api/auth/login", () => {
    it("should return 400 for invalid payload", async () => {
      const app = Fastify();
      await app.register(cookie);
      registerAuthRoutes(app);

      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          accessKeyId: "",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
    });

    it("should return 401 for invalid credentials", async () => {
      const app = Fastify();
      await app.register(cookie);
      registerAuthRoutes(app);

      const mockedValidate = vi.mocked(validateCredentials);
      mockedValidate.mockRejectedValueOnce(new Error("Invalid credentials"));

      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          accessKeyId: "invalid",
          secretAccessKey: "invalid",
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
    });

    it("should create session and set cookie for valid credentials", async () => {
      const app = Fastify();
      await app.register(cookie);
      registerAuthRoutes(app);

      const mockedValidate = vi.mocked(validateCredentials);
      mockedValidate.mockResolvedValueOnce(undefined);

      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: TEST_CREDENTIALS,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);

      // Check cookie was set
      const setCookieHeader = response.headers["set-cookie"];
      expect(setCookieHeader).toBeDefined();
      expect(setCookieHeader).toContain(config.COOKIE_NAME);
    });
  });

  describe("POST /api/auth/logout", () => {
    it("should clear cookie and delete session", async () => {
      const app = Fastify();
      await app.register(cookie);
      registerAuthRoutes(app);

      const token = await createSession(TEST_CREDENTIALS);

      const response = await app.inject({
        method: "POST",
        url: "/api/auth/logout",
        cookies: {
          [config.COOKIE_NAME]: token,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);

      // Check session was deleted
      const session = await getSessionCredentials(token);
      expect(session).toBeNull();

      // Check cookie was cleared
      const setCookieHeader = response.headers["set-cookie"];
      expect(setCookieHeader).toBeDefined();
    });

    it("should handle logout without cookie", async () => {
      const app = Fastify();
      await app.register(cookie);
      registerAuthRoutes(app);

      const response = await app.inject({
        method: "POST",
        url: "/api/auth/logout",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
    });
  });

  describe("GET /api/auth/me", () => {
    it("should return 401 if not authenticated", async () => {
      const app = Fastify();
      await app.register(cookie);
      registerAuthRoutes(app);

      const response = await app.inject({
        method: "GET",
        url: "/api/auth/me",
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("Not authenticated");
    });

    it("should return 401 if session expired", async () => {
      const app = Fastify();
      await app.register(cookie);
      registerAuthRoutes(app);

      const response = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        cookies: {
          [config.COOKIE_NAME]: "expired-token",
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe("Session expired");
    });

    it("should return ok for valid session", async () => {
      const app = Fastify();
      await app.register(cookie);
      registerAuthRoutes(app);

      const token = await createSession(TEST_CREDENTIALS);

      const response = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        cookies: {
          [config.COOKIE_NAME]: token,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
    });
  });
});
