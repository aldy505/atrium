import { describe, it, expect, afterEach } from "vitest";
import Fastify from "fastify";
import { registerRuntimeConfigRoute } from "../src/server/runtime-config.js";

describe("/api/runtime-config", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("ignores VITE_SENTRY_* variables when FRONTEND_* are absent", async () => {
    delete process.env.FRONTEND_SENTRY_DSN;
    process.env.VITE_SENTRY_DSN = "vite-only";

    const app = Fastify();
    registerRuntimeConfigRoute(app);

    const res = await app.inject({ method: "GET", url: "/api/runtime-config" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.sentry.dsn).toBeUndefined();
  });

  it("returns FRONTEND_SENTRY_* values when provided", async () => {
    process.env.FRONTEND_SENTRY_DSN = "front-dsn";
    process.env.VITE_SENTRY_DSN = "vite-dsn";
    process.env.FRONTEND_SENTRY_ENABLE_LOGS = "false";

    const app = Fastify();
    registerRuntimeConfigRoute(app);

    const res = await app.inject({ method: "GET", url: "/api/runtime-config" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.sentry.dsn).toBe("front-dsn");
    expect(body.sentry.enableLogs).toBe(false);
  });
});
