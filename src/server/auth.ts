import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
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
    throw new AppError("Session expired. Please log in again.", 401);
  }

  request.sessionToken = token;
  request.sessionCredentials = sessionCredentials;
};

export const registerAuthRoutes = (app: FastifyInstance): void => {
  app.post("/api/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);

    if (!parsed.success) {
      recordAuthResultGauge(false, {
        stage: "login",
        reason: "invalid_payload",
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

    reply.setCookie(config.COOKIE_NAME, token, cookieConfig);
    return reply.send({ ok: true });
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const token = request.cookies[config.COOKIE_NAME];

    if (token) {
      await deleteSession(token);
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
      return reply.code(401).send({ error: "Session expired" });
    }

    recordAuthResultGauge(true, {
      stage: "me",
    });

    return reply.send({ ok: true });
  });
};
