import { Cluster, Redis } from "ioredis";
import { config } from "./config.js";

export type RedisClient = Redis | Cluster;

export const isCluster = (client: RedisClient): client is Cluster => client instanceof Cluster;

export const createRedisClient = (): RedisClient => {
  const clusterUrls = config.REDIS_CLUSTER_URLS?.trim();

  if (clusterUrls) {
    const parsed = clusterUrls.split(",").map((raw) => new URL(raw.trim()));
    const nodes = parsed.map((url) => ({
      host: url.hostname,
      port: Number(url.port) || 6379,
    }));

    const password = parsed.find((url) => url.password)?.password;
    const enableTls = parsed.some((url) => url.protocol === "rediss:");

    const redisOptions: { password?: string; tls?: object } = {};
    if (password) redisOptions.password = password;
    if (enableTls) redisOptions.tls = {};

    return new Cluster(nodes, { redisOptions });
  }

  if (!config.REDIS_URL) {
    throw new Error("Either REDIS_URL or REDIS_CLUSTER_URLS must be configured");
  }

  return new Redis(config.REDIS_URL);
};
