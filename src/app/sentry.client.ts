import * as Sentry from "@sentry/react";

const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;

if (dsn) {
  Sentry.init({
    dsn,
    environment:
      (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) || import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE as string | undefined,
    tracesSampleRate: Number.parseFloat(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || "0.1"),
    enableLogs: (import.meta.env.VITE_SENTRY_ENABLE_LOGS || "true") !== "false",
    enableMetrics: (import.meta.env.VITE_SENTRY_ENABLE_METRICS || "true") !== "false",
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration(),
      Sentry.feedbackIntegration({
        colorScheme: "system",
      }),
    ],
    replaysSessionSampleRate: Number.parseFloat(
      import.meta.env.VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE || "0.1",
    ),
    replaysOnErrorSampleRate: Number.parseFloat(
      import.meta.env.VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE || "1.0",
    ),
  });

  Sentry.logger.info("Frontend initialized", {
    mode: import.meta.env.MODE,
  });

  Sentry.metrics.count("frontend.app.boot", 1);
}
