import crypto from "node:crypto";
import { Redis } from "ioredis";
import { config } from "./config.js";
import type { SessionCredentials } from "./types.js";

const redis = new Redis(config.REDIS_URL);

const sessionKey = (token: string) => `session:${token}`;

export const createSession = async (credentials: SessionCredentials): Promise<string> => {
  const token = crypto.randomBytes(48).toString("base64url");
  const payload = JSON.stringify(credentials);
  await redis.set(sessionKey(token), payload, "EX", config.SESSION_TTL_SECONDS);
  return token;
};

export const getSessionCredentials = async (token: string): Promise<SessionCredentials | null> => {
  const data = await redis.get(sessionKey(token));

  if (!data) {
    return null;
  }

  // Sliding expiration keeps active sessions alive while preserving bounded TTL for idle sessions.
  await redis.expire(sessionKey(token), config.SESSION_TTL_SECONDS);
  return JSON.parse(data) as SessionCredentials;
};

export const deleteSession = async (token: string): Promise<void> => {
  await redis.del(sessionKey(token));
};

export const closeRedis = async (): Promise<void> => {
  await redis.quit();
};
