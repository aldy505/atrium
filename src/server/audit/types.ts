export type AuditResult = "success" | "failure";

export type AuditEvent = {
  timestamp?: string;
  sessionToken?: string;
  accessKeyHash?: string;
  operation: string;
  bucket?: string;
  key?: string;
  prefix?: string;
  resourcePath?: string;
  result: AuditResult;
  error?: string;
  durationMs?: number;
};

export type AuditSink = {
  write(event: AuditEvent): Promise<void>;
  shutdown(): Promise<void>;
};
