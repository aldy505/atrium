import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { hashAccessKeyId, hashSessionToken, recordAuditEvent } from "./audit/index.js";
import { cookieConfig, config } from "./config.js";
import { AppError, toErrorMessage } from "./errors.js";
import { recordAuthResultGauge } from "./observability.js";
import { validateCredentials } from "./s3.js";
import { createSession, deleteSession, getSessionCredentials } from "./session.js";
import type { SessionCredentials } from "./types.js";

declare module "fastify" {
  interface FastifyRequest {
    sessionToken?: string;
    sessionCredentials?: SessionCredentials;
  }
}

const loginSchema = z.object({
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
});

export const requireSession = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const token = request.cookies[config.COOKIE_NAME];

  if (!token) {
    recordAuthResultGauge(false, {
      stage: "require_session",
      reason: "missing_cookie",
    });
    void recordAuditEvent({
      operation: "auth.session",
      result: "failure",
      error: "missing_cookie",
    });
    throw new AppError("Not authenticated", 401);
  }

  const sessionCredentials = await getSessionCredentials(token);

  if (!sessionCredentials) {
    recordAuthResultGauge(false, {
      stage: "require_session",
      reason: "session_expired",
    });
    reply.clearCookie(config.COOKIE_NAME, {
      path: "/",
    });
    void recordAuditEvent({
      operation: "auth.session",
      sessionToken: hashSessionToken(token),
      result: "failure",
      error: "session_expired",
    });
    throw new AppError("Session expired. Please log in again.", 401);
  }

  request.sessionToken = token;
  request.sessionCredentials = sessionCredentials;
};

export const registerAuthRoutes = (app: FastifyInstance): void => {
  app.post("/api/auth/login", async (request, reply) => {
    const startedAt = Date.now();
    const parsed = loginSchema.safeParse(request.body);

    if (!parsed.success) {
      recordAuthResultGauge(false, {
        stage: "login",
        reason: "invalid_payload",
      });
      void recordAuditEvent({
        operation: "auth.login",
        result: "failure",
        error: "invalid_payload",
        durationMs: Date.now() - startedAt,
      });
      throw new AppError("Invalid login payload", 400, true);
    }

    const credentials: SessionCredentials = parsed.data;

    try {
      await validateCredentials(credentials);
    } catch (error) {
      recordAuthResultGauge(false, {
        stage: "login",
        reason: "invalid_credentials",
      });
      void recordAuditEvent({
        operation: "auth.login",
        result: "failure",
        accessKeyHash: hashAccessKeyId(credentials.accessKeyId),
        error: toErrorMessage(error),
        durationMs: Date.now() - startedAt,
      });
      throw new AppError(
        `Invalid credentials or provider access denied: ${toErrorMessage(error)}`,
        401,
        true,
      );
    }

    const token = await createSession(credentials);
    recordAuthResultGauge(true, {
      stage: "login",
    });
    void recordAuditEvent({
      operation: "auth.login",
      result: "success",
      sessionToken: hashSessionToken(token),
      accessKeyHash: hashAccessKeyId(credentials.accessKeyId),
      durationMs: Date.now() - startedAt,
    });

    reply.setCookie(config.COOKIE_NAME, token, cookieConfig);
    return reply.send({ ok: true });
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const token = request.cookies[config.COOKIE_NAME];

    if (token) {
      let credentials: SessionCredentials | null = null;

      try {
        credentials = await getSessionCredentials(token);
      } catch {
        credentials = null;
      }

      await deleteSession(token);
      void recordAuditEvent({
        operation: "auth.logout",
        result: credentials ? "success" : "failure",
        sessionToken: hashSessionToken(token),
        accessKeyHash: hashAccessKeyId(credentials?.accessKeyId),
        error: credentials ? undefined : "session_expired",
      });
    } else {
      void recordAuditEvent({
        operation: "auth.logout",
        result: "failure",
        error: "missing_cookie",
      });
    }

    reply.clearCookie(config.COOKIE_NAME, {
      path: "/",
    });

    return reply.send({ ok: true });
  });

  app.get("/api/auth/me", async (request, reply) => {
    const token = request.cookies[config.COOKIE_NAME];

    if (!token) {
      recordAuthResultGauge(false, {
        stage: "me",
        reason: "missing_cookie",
      });
      void recordAuditEvent({
        operation: "auth.me",
        result: "failure",
        error: "missing_cookie",
      });
      return reply.code(401).send({ error: "Not authenticated" });
    }

    const sessionCredentials = await getSessionCredentials(token);

    if (!sessionCredentials) {
      recordAuthResultGauge(false, {
        stage: "me",
        reason: "session_expired",
      });
      reply.clearCookie(config.COOKIE_NAME, {
        path: "/",
      });
      void recordAuditEvent({
        operation: "auth.me",
        result: "failure",
        sessionToken: hashSessionToken(token),
        error: "session_expired",
      });
      return reply.code(401).send({ error: "Session expired" });
    }

    recordAuthResultGauge(true, {
      stage: "me",
    });
    void recordAuditEvent({
      operation: "auth.me",
      result: "success",
      sessionToken: hashSessionToken(token),
      accessKeyHash: hashAccessKeyId(sessionCredentials.accessKeyId),
    });

    return reply.send({ ok: true });
  });
};
