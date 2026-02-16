import { promises as fs } from "node:fs";
import path from "node:path";
import type { AuditEvent, AuditSink } from "./types.js";

const CSV_HEADERS = [
  "timestamp",
  "sessionToken",
  "accessKeyHash",
  "operation",
  "bucket",
  "key",
  "prefix",
  "resourcePath",
  "result",
  "error",
  "durationMs",
];

const toCsvValue = (value: unknown): string => {
  if (value === undefined || value === null) {
    return "";
  }

  const text = String(value);

  if (/["]|,|\n/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
};

const toCsvLine = (event: AuditEvent): string => {
  const values = [
    event.timestamp,
    event.sessionToken,
    event.accessKeyHash,
    event.operation,
    event.bucket,
    event.key,
    event.prefix,
    event.resourcePath,
    event.result,
    event.error,
    event.durationMs,
  ];

  return values.map(toCsvValue).join(",");
};

const formatDateKey = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}${month}${day}`;
};

const parseDateKey = (value: string): Date | null => {
  const match = /^audit-log_(\d{4})(\d{2})(\d{2})\.csv$/.exec(value);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!year || !month || !day) {
    return null;
  }

  return new Date(Date.UTC(year, month - 1, day));
};

export class FilesystemAuditSink implements AuditSink {
  private readonly dir: string;
  private readonly retentionDays: number;
  private lastCleanupKey: string | null = null;

  constructor(dir: string, retentionDays: number) {
    this.dir = dir;
    this.retentionDays = retentionDays;
  }

  async write(event: AuditEvent): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });

    const eventDate = event.timestamp ? new Date(event.timestamp) : new Date();
    const dateKey = formatDateKey(eventDate);
    const filePath = path.join(this.dir, `audit-log_${dateKey}.csv`);

    const line = toCsvLine(event);
    await this.appendWithHeader(filePath, line);
    await this.maybeCleanup(dateKey);
  }

  async shutdown(): Promise<void> {
    await this.maybeCleanup(formatDateKey(new Date()));
  }

  private async appendWithHeader(filePath: string, line: string): Promise<void> {
    const handle = await fs.open(filePath, "a+");

    try {
      const stats = await handle.stat();

      if (stats.size === 0) {
        await handle.writeFile(`${CSV_HEADERS.join(",")}\n`);
      }

      await handle.writeFile(`${line}\n`);
    } finally {
      await handle.close();
    }
  }

  private async maybeCleanup(dateKey: string): Promise<void> {
    if (this.retentionDays <= 0) {
      return;
    }

    if (this.lastCleanupKey === dateKey) {
      return;
    }

    this.lastCleanupKey = dateKey;

    const cutoffMs = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;

    let entries: string[] = [];

    try {
      entries = await fs.readdir(this.dir);
    } catch {
      return;
    }

    await Promise.all(
      entries.map(async (entry) => {
        const entryDate = parseDateKey(entry);

        if (!entryDate || entryDate.getTime() >= cutoffMs) {
          return;
        }

        const target = path.join(this.dir, entry);

        try {
          await fs.unlink(target);
        } catch {
          return;
        }
      }),
    );
  }
}
