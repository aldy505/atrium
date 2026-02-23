import { FastifyInstance } from "fastify";
import { config } from "./config.js";
import { OpenFeature } from "@openfeature/server-sdk";
import type { RuntimeConfigResponse } from "../shared/types.js";

export function registerRuntimeConfigRoute(app: FastifyInstance): void {
  app.get("/api/runtime-config", async () => {
    // runtime values are driven by FRONTEND_SENTRY_* variables only. build-time
    // VITE_* keys are no longer consulted to keep the configuration surface
    // minimal and reduce confusion.
    const sentryDsn = process.env.FRONTEND_SENTRY_DSN;

    let enableS3UriCopy = false;
    try {
      enableS3UriCopy = await OpenFeature.getClient().getBooleanValue("ENABLE_S3_URI_COPY", false);
    } catch (err) {
      app.log.debug({ err }, "Failed to resolve ENABLE_S3_URI_COPY; defaulting to false");
    }

    const response: RuntimeConfigResponse = {
      sentry: {
        dsn: sentryDsn,
        environment: process.env.FRONTEND_SENTRY_ENVIRONMENT || config.NODE_ENV,
        release: process.env.FRONTEND_SENTRY_RELEASE,
        tracesSampleRate: process.env.FRONTEND_SENTRY_TRACES_SAMPLE_RATE || "0.1",
        enableLogs: (process.env.FRONTEND_SENTRY_ENABLE_LOGS || "true") !== "false",
        enableMetrics: (process.env.FRONTEND_SENTRY_ENABLE_METRICS || "true") !== "false",
        replaysSessionSampleRate: process.env.FRONTEND_SENTRY_REPLAYS_SESSION_SAMPLE_RATE || "0.1",
        replaysOnErrorSampleRate: process.env.FRONTEND_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE || "1.0",
      },
      features: {
        enableS3UriCopy,
      },
    };

    return response;
  });
}
