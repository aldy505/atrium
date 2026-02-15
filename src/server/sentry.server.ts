import "dotenv/config";
import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
    enableLogs: (process.env.SENTRY_ENABLE_LOGS || "true") !== "false",
    enableMetrics: (process.env.SENTRY_ENABLE_METRICS || "true") !== "false",
    integrations: [
      Sentry.consoleLoggingIntegration({
        levels: ["log", "warn", "error"],
      }),
    ],
  });
}
