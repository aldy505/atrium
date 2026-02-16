import { createHash } from "node:crypto";
import { config } from "../config.js";
import { toErrorMessage } from "../errors.js";
import { FilesystemAuditSink } from "./fs-sink.js";
import { LokiAuditSink } from "./loki-sink.js";
import type { AuditEvent, AuditSink } from "./types.js";

const MAX_ERROR_LENGTH = 1000;

class NoopAuditSink implements AuditSink {
  async write(): Promise<void> {
    return;
  }

  async shutdown(): Promise<void> {
    return;
  }
}

let auditSink: AuditSink = new NoopAuditSink();

const buildResourcePath = (event: AuditEvent): string | undefined => {
  if (!event.bucket) {
    return event.resourcePath;
  }

  const suffix = event.key ?? event.prefix;

  if (!suffix) {
    return event.bucket;
  }

  return `${event.bucket}/${suffix}`;
};

const normalizeEvent = (event: AuditEvent): AuditEvent => {
  const timestamp = event.timestamp || new Date().toISOString();
  const error = event.error ? event.error.slice(0, MAX_ERROR_LENGTH) : undefined;
  const resourcePath = event.resourcePath || buildResourcePath(event);

  return {
    ...event,
    timestamp,
    error,
    resourcePath,
  };
};

export const initializeAuditLogger = (): AuditSink => {
  if (config.AUDIT_LOG_SINK === "filesystem") {
    auditSink = new FilesystemAuditSink(config.AUDIT_LOG_DIR, config.AUDIT_LOG_RETENTION_DAYS);
    return auditSink;
  }

  if (config.AUDIT_LOG_SINK === "loki") {
    auditSink = new LokiAuditSink(config.AUDIT_LOG_LOKI_URL!, {
      app: "atrium",
      env: config.NODE_ENV,
      source: "audit",
    });
    return auditSink;
  }

  auditSink = new NoopAuditSink();
  return auditSink;
};

export const shutdownAuditLogger = async (): Promise<void> => {
  await auditSink.shutdown();
};

export const hashAccessKeyId = (accessKeyId?: string): string | undefined => {
  if (!accessKeyId) {
    return undefined;
  }

  return createHash("sha256").update(accessKeyId).digest("hex");
};

export const hashSessionToken = (token?: string): string | undefined => {
  if (!token) {
    return undefined;
  }

  return createHash("sha256").update(token).digest("hex");
};

export const recordAuditEvent = async (event: AuditEvent): Promise<void> => {
  try {
    await auditSink.write(normalizeEvent(event));
  } catch (error) {
    console.error("Failed to write audit event", toErrorMessage(error));
  }
};

export type { AuditEvent } from "./types.js";
