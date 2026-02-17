import "dotenv/config";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import * as Sentry from "@sentry/node";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { OpenFeature, MultiProvider, FirstMatchStrategy } from "@openfeature/server-sdk";
import { OFREPProvider } from "@openfeature/ofrep-provider";
import { EnvVarProvider } from "@openfeature/env-var-provider";
import { config } from "./config.js";
import { initializeAuditLogger, shutdownAuditLogger } from "./audit/index.js";
import { AppError, toErrorMessage } from "./errors.js";
import { registerAuthRoutes } from "./auth.js";
import { registerS3Routes } from "./routes.js";
import { captureServerError, registerObservabilityHooks, sentryLog } from "./observability.js";

// Create providers
const primaryProvider = new OFREPProvider({});
const backupProvider = new EnvVarProvider();

// Create multi-provider with a strategy
const multiProvider = new MultiProvider(
  [{ provider: primaryProvider }, { provider: backupProvider }],
  new FirstMatchStrategy(),
);

// Register the multi-provider
await OpenFeature.setProviderAndWait(multiProvider);

const app = Fastify({ logger: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDistPath = path.resolve(__dirname, "../client");
const clientIndexPath = path.join(clientDistPath, "index.html");

await app.register(cookie);
await app.register(cors, {
  origin: true,
  credentials: true,
});
await app.register(multipart, {
  limits: {
    fileSize: config.MAX_UPLOAD_SIZE_MB * 1024 * 1024,
  },
});
registerObservabilityHooks(app);
initializeAuditLogger();

registerAuthRoutes(app);
registerS3Routes(app);

app.addHook("onClose", async () => {
  await shutdownAuditLogger();
});

app.get("/api/runtime-config", async () => {
  const sentryDsn = process.env.FRONTEND_SENTRY_DSN || process.env.VITE_SENTRY_DSN;

  return {
    sentry: {
      dsn: sentryDsn,
      environment:
        process.env.FRONTEND_SENTRY_ENVIRONMENT ||
        process.env.VITE_SENTRY_ENVIRONMENT ||
        config.NODE_ENV,
      release: process.env.FRONTEND_SENTRY_RELEASE || process.env.VITE_SENTRY_RELEASE,
      tracesSampleRate:
        process.env.FRONTEND_SENTRY_TRACES_SAMPLE_RATE ||
        process.env.VITE_SENTRY_TRACES_SAMPLE_RATE ||
        "0.1",
      enableLogs:
        (process.env.FRONTEND_SENTRY_ENABLE_LOGS ||
          process.env.VITE_SENTRY_ENABLE_LOGS ||
          "true") !== "false",
      enableMetrics:
        (process.env.FRONTEND_SENTRY_ENABLE_METRICS ||
          process.env.VITE_SENTRY_ENABLE_METRICS ||
          "true") !== "false",
      replaysSessionSampleRate:
        process.env.FRONTEND_SENTRY_REPLAYS_SESSION_SAMPLE_RATE ||
        process.env.VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE ||
        "0.1",
      replaysOnErrorSampleRate:
        process.env.FRONTEND_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE ||
        process.env.VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE ||
        "1.0",
    },
  };
});

if (config.NODE_ENV === "production" || existsSync(clientIndexPath)) {
  await app.register(fastifyStatic, {
    root: clientDistPath,
    prefix: "/",
  });

  app.get("/", async (_, reply) => {
    return reply.sendFile("index.html");
  });
}

app.setErrorHandler((error, request, reply) => {
  app.log.error(error);
  captureServerError(error, request);
  Sentry.metrics.count("http.request.errors", 1, {
    attributes: {
      method: request.method,
      route: request.routeOptions.url || request.url,
      status_code: reply.statusCode,
    },
  });

  if (error instanceof AppError) {
    return reply.code(error.statusCode).send({
      error: error.message,
      details: error.exposeDetails ? error.message : undefined,
    });
  }

  const statusCode = (error as { statusCode?: number }).statusCode ?? 500;

  return reply.code(statusCode).send({
    error: statusCode === 500 ? "Internal server error" : toErrorMessage(error),
  });
});

const start = async () => {
  try {
    await app.listen({
      port: config.PORT,
      host: "0.0.0.0",
    });
    sentryLog("info", "Fastify server started", {
      port: config.PORT,
      environment: config.NODE_ENV,
    });
  } catch (error) {
    app.log.error(error);
    captureServerError(error);
    process.exit(1);
  }
};

await start();
