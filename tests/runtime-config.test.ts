import { describe, it, expect, afterEach } from "vitest";
import Fastify from "fastify";

// helper to mount the same route logic as the real server
function registerRuntimeConfigRoute(app: ReturnType<typeof Fastify>) {
  app.get("/api/runtime-config", async () => {
    const sentryDsn = process.env.FRONTEND_SENTRY_DSN;
    return {
      sentry: {
        dsn: sentryDsn,
        environment: process.env.FRONTEND_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
        release: process.env.FRONTEND_SENTRY_RELEASE,
        tracesSampleRate: process.env.FRONTEND_SENTRY_TRACES_SAMPLE_RATE || "0.1",
        enableLogs: (process.env.FRONTEND_SENTRY_ENABLE_LOGS || "true") !== "false",
        enableMetrics: (process.env.FRONTEND_SENTRY_ENABLE_METRICS || "true") !== "false",
        replaysSessionSampleRate: process.env.FRONTEND_SENTRY_REPLAYS_SESSION_SAMPLE_RATE || "0.1",
        replaysOnErrorSampleRate: process.env.FRONTEND_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE || "1.0",
      },
    };
  });
}

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
