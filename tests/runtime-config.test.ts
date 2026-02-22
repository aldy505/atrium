import { describe, it, expect, vi, afterEach } from "vitest";
import Fastify from "fastify";
import { registerRuntimeConfigRoute } from "../src/server/runtime-config.js";

// use Vitest env helpers to avoid mutating process.env directly

describe("/api/runtime-config", () => {
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
      expect(body.sentry.dsn).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it("returns FRONTEND_SENTRY_* values when provided", async () => {
    vi.stubEnv("FRONTEND_SENTRY_DSN", "front-dsn");
    vi.stubEnv("VITE_SENTRY_DSN", "vite-dsn");
    vi.stubEnv("FRONTEND_SENTRY_ENABLE_LOGS", "false");

    const app = Fastify();
    registerRuntimeConfigRoute(app);

    try {
      const res = await app.inject({ method: "GET", url: "/api/runtime-config" });
      expect(res.statusCode).toBe(200);
      const body = res.json() as any;
      expect(body.sentry.dsn).toBe("front-dsn");
      expect(body.sentry.enableLogs).toBe(false);
    } finally {
      await app.close();
    }
  });
});
