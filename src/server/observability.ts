import * as Sentry from "@sentry/node";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";

type FastifyRequestWithStart = FastifyRequest & {
  sentryRequestStartMs?: number;
};

const getRouteName = (request: FastifyRequest): string => {
  return request.routeOptions.url || request.url;
};

const SENSITIVE_KEYS = new Set([
  "secretaccesskey",
  "accesskeyid",
  "password",
  "authorization",
  "cookie",
]);

const sanitizeAttributes = (value: unknown): unknown => {
  if (!value || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeAttributes);
  }

  const record = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  for (const [key, entryValue] of Object.entries(record)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      output[key] = "[REDACTED]";
      continue;
    }

    output[key] = sanitizeAttributes(entryValue);
  }

  return output;
};

const sentryEnabled = (): boolean => Boolean(config.SENTRY_DSN);
const sentryMetricsEnabled = (): boolean => sentryEnabled() && config.SENTRY_ENABLE_METRICS;

let authSuccessTotal = 0;
let authFailureTotal = 0;

type SentryLogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export const sentryLog = (
  level: SentryLogLevel,
  message: string,
  attributes?: Record<string, unknown>,
): void => {
  if (!sentryEnabled() || !config.SENTRY_ENABLE_LOGS) {
    return;
  }

  const sanitized = sanitizeAttributes(attributes) as Record<string, unknown> | undefined;
  Sentry.logger[level](message, sanitized);
};

export const sentryCountMetric = (
  name: string,
  value: number,
  attributes?: Record<string, unknown>,
): void => {
  if (!sentryMetricsEnabled()) {
    return;
  }

  const sanitized = sanitizeAttributes(attributes) as Record<string, string | number | boolean>;
  Sentry.metrics.count(name, value, {
    attributes: sanitized,
  });
};

export const sentryGaugeMetric = (
  name: string,
  value: number,
  attributes?: Record<string, unknown>,
): void => {
  if (!sentryMetricsEnabled()) {
    return;
  }

  const sanitized = sanitizeAttributes(attributes) as Record<string, string | number | boolean>;
  Sentry.metrics.gauge(name, value, {
    attributes: sanitized,
  });
};

export const sentryDistributionMetric = (
  name: string,
  value: number,
  unit: "none" | "millisecond" = "none",
  attributes?: Record<string, unknown>,
): void => {
  if (!sentryMetricsEnabled()) {
    return;
  }

  const sanitized = sanitizeAttributes(attributes) as Record<string, string | number | boolean>;
  Sentry.metrics.distribution(name, value, {
    unit,
    attributes: sanitized,
  });
};

export const recordAuthResultGauge = (
  isSuccess: boolean,
  attributes?: Record<string, unknown>,
): void => {
  if (isSuccess) {
    authSuccessTotal += 1;
  } else {
    authFailureTotal += 1;
  }

  sentryGaugeMetric("auth.success", authSuccessTotal, attributes);
  sentryGaugeMetric("auth.failure", authFailureTotal, attributes);
};

export const registerObservabilityHooks = (app: FastifyInstance): void => {
  app.addHook("onRequest", (request, _, done) => {
    const requestWithStart = request as FastifyRequestWithStart;
    requestWithStart.sentryRequestStartMs = Date.now();

    if (sentryEnabled() && config.SENTRY_ENABLE_LOGS) {
      Sentry.getIsolationScope().setAttributes({
        route: getRouteName(request),
        method: request.method,
      });

      sentryLog("info", "Incoming API request", {
        method: request.method,
        route: getRouteName(request),
      });
    }

    const metricAttributes = sanitizeAttributes({
      method: request.method,
      route: getRouteName(request),
    }) as Record<string, string | number | boolean>;

    sentryCountMetric("http.requests.total", 1, metricAttributes);

    done();
  });

  app.addHook("onResponse", (request, reply, done) => {
    if (!sentryEnabled()) {
      done();
      return;
    }

    const requestWithStart = request as FastifyRequestWithStart;
    const startedAt = requestWithStart.sentryRequestStartMs || Date.now();
    const durationMs = Date.now() - startedAt;

    sentryLog("info", "API request completed", {
      method: request.method,
      route: getRouteName(request),
      status_code: reply.statusCode,
      duration_ms: durationMs,
    });

    const attributes = sanitizeAttributes({
      method: request.method,
      route: getRouteName(request),
      status_code: reply.statusCode,
    }) as Record<string, string | number | boolean>;

    sentryDistributionMetric("http.server.duration", durationMs, "millisecond", attributes);

    if (reply.statusCode >= 500) {
      sentryCountMetric("http.requests.errors", 1, attributes);
    }

    done();
  });
};

export const captureServerError = (
  error: unknown,
  request?: FastifyRequest,
  reply?: FastifyReply,
): void => {
  if (!sentryEnabled()) {
    return;
  }

  Sentry.withScope((scope) => {
    if (request) {
      scope.setTags({
        method: request.method,
        route: getRouteName(request),
      });
    }

    if (reply) {
      scope.setTag("status_code", reply.statusCode.toString());
    }

    scope.setContext("request", {
      method: request?.method,
      url: request?.url,
      query: (sanitizeAttributes(request?.query) as Record<string, unknown>) || undefined,
    });

    Sentry.captureException(error);
  });
};

export const shutdownObservability = async (): Promise<void> => {
  if (!sentryEnabled()) {
    return;
  }

  await Sentry.flush(2000);
};
