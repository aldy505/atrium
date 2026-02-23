import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import Fastify from "fastify";
import { OpenFeature } from "@openfeature/server-sdk";
import { EnvVarProvider } from "@openfeature/env-var-provider";
import { registerRuntimeConfigRoute } from "../src/server/runtime-config.js";

// use Vitest env helpers to avoid mutating process.env directly

describe("/api/runtime-config", () => {
  beforeAll(async () => {
    // Initialize OpenFeature with EnvVarProvider for tests
    await OpenFeature.setProviderAndWait(new EnvVarProvider());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("ignores VITE_SENTRY_* variables when FRONTEND_* are absent", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "vite-only");

    const app = Fastify();
    registerRuntimeConfigRoute(app);

    try {
      const res = await app.inject({ method: "GET", url: "/api/runtime-config" });
      expect(res.statusCode).toBe(200);
      const body = res.json() as any;
      // basic fields
      expect(body.sentry.dsn).toBeUndefined();
      expect(body.sentry.environment).toBe(process.env.NODE_ENV);
      expect(body.sentry.tracesSampleRate).toBe("0.1");
      expect(body.sentry.enableMetrics).toBe(true);
      expect(body.sentry.release).toBeUndefined();
      expect(body.sentry.replaysSessionSampleRate).toBe("0.1");
      expect(body.sentry.replaysOnErrorSampleRate).toBe("1.0");
      expect(body.features?.enableS3UriCopy).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("returns FRONTEND_SENTRY_* values when provided", async () => {
    vi.stubEnv("FRONTEND_SENTRY_DSN", "front-dsn");
    vi.stubEnv("FRONTEND_SENTRY_ENABLE_LOGS", "false");
    vi.stubEnv("ENABLE_S3_URI_COPY", "true");

    const app = Fastify();
    registerRuntimeConfigRoute(app);

    try {
      const res = await app.inject({ method: "GET", url: "/api/runtime-config" });
      expect(res.statusCode).toBe(200);
      const body = res.json() as any;
      expect(body.sentry.dsn).toBe("front-dsn");
      expect(body.sentry.enableLogs).toBe(false);
      expect(body.sentry.release).toBeUndefined();
      expect(body.sentry.tracesSampleRate).toBe("0.1");
      expect(body.sentry.enableMetrics).toBe(true);
      expect(body.sentry.replaysSessionSampleRate).toBe("0.1");
      expect(body.sentry.replaysOnErrorSampleRate).toBe("1.0");
      expect(body.features?.enableS3UriCopy).toBe(true);
    } finally {
      await app.close();
    }
  });
});
