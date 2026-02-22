import * as Sentry from "@sentry/react";
import { getRuntimeConfig } from "./lib/api";
import type { RuntimeSentryConfig } from "./lib/types";

const parseRate = (value: string | number | undefined, fallback: string): number => {
  const input = value ?? fallback;
  const parsed = Number.parseFloat(String(input));
  return Number.isFinite(parsed) ? parsed : Number.parseFloat(fallback);
};

const fetchRuntimeSentryConfig = async (): Promise<RuntimeSentryConfig | null> => {
  try {
    const body = await getRuntimeConfig();
    return body.sentry || null;
  } catch {
    return null;
  }
};

export const initializeSentry = async (): Promise<void> => {
  const runtimeConfig = await fetchRuntimeSentryConfig();
  const dsn = runtimeConfig?.dsn;

  // Do not initialize if runtime config lacks a DSN. This keeps the UI
  // silent when nobody has provided frontend credentials (e.g. in a local
  // development environment before backend is started).
  if (!dsn) {
    return;
  }

  const environment = runtimeConfig?.environment ?? import.meta.env.MODE;
  const release = runtimeConfig?.release;
  const enableLogs = runtimeConfig?.enableLogs ?? true;
  const enableMetrics = runtimeConfig?.enableMetrics ?? true;

  Sentry.init({
    dsn,
    environment,
    release,
    tracesSampleRate: parseRate(runtimeConfig?.tracesSampleRate, "0.1"),
    enableLogs,
    enableMetrics,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration(),
      Sentry.feedbackIntegration({
        colorScheme: "system",
      }),
    ],
    replaysSessionSampleRate: parseRate(runtimeConfig?.replaysSessionSampleRate, "0.1"),
    replaysOnErrorSampleRate: parseRate(runtimeConfig?.replaysOnErrorSampleRate, "1.0"),
  });

  Sentry.logger.info("Frontend initialized", {
    mode: import.meta.env.MODE,
    runtime_config: Boolean(runtimeConfig),
  });

  Sentry.metrics.count("frontend.app.boot", 1);
};
