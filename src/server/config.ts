import { z } from "zod";

const parseEnvBool = (val: unknown, def: boolean): boolean => {
  if (typeof val === "boolean") return val;
  if (typeof val === "string") {
    const v = val.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(v)) return true;
    if (["0", "false", "no", "off", ""].includes(v)) return false;
  }
  if (typeof val === "number") return val !== 0;
  return def;
};

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),
  REDIS_URL: z.string().min(1),
  S3_LIST_CACHE_ENABLED: z.preprocess((v) => parseEnvBool(v, true), z.boolean()).default(true),
  S3_LIST_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  S3_LIST_CACHE_INVALIDATION_MODE: z.enum(["targeted", "bucket"]).default("targeted"),
  S3_LIST_CACHE_INCLUDE_HEADERS: z
    .preprocess((v) => parseEnvBool(v, true), z.boolean())
    .default(true),
  S3_ENDPOINT: z.string().min(1),
  S3_REGION: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.preprocess((v) => parseEnvBool(v, true), z.boolean()).default(true),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(86400),
  COOKIE_NAME: z.string().default("atrium_session"),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().positive().default(100),
  AUDIT_LOG_SINK: z.enum(["filesystem", "loki", "none"]).default("filesystem"),
  AUDIT_LOG_DIR: z.string().default("audit-logs"),
  AUDIT_LOG_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  AUDIT_LOG_LOKI_URL: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_RELEASE: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
  SENTRY_ENABLE_LOGS: z.preprocess((v) => parseEnvBool(v, true), z.boolean()).default(true),
  SENTRY_ENABLE_METRICS: z.preprocess((v) => parseEnvBool(v, true), z.boolean()).default(true),
  OFREP_ENDPOINT: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

if (parsed.data.AUDIT_LOG_SINK === "loki" && !parsed.data.AUDIT_LOG_LOKI_URL) {
  console.error("AUDIT_LOG_LOKI_URL is required when AUDIT_LOG_SINK=loki");
  process.exit(1);
}

export const config = parsed.data;

export const cookieConfig = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: config.NODE_ENV === "production",
  maxAge: config.SESSION_TTL_SECONDS,
};
