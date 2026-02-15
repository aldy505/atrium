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

    Sentry.metrics.count("http.requests.total", 1, {
      attributes: metricAttributes,
    });

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

    Sentry.metrics.distribution("http.server.duration", durationMs, {
      unit: "millisecond",
      attributes,
    });

    if (reply.statusCode >= 500) {
      Sentry.metrics.count("http.requests.errors", 1, {
        attributes,
      });
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
