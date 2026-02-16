import type { AuditEvent, AuditSink } from "./types.js";

type LokiLabels = Record<string, string>;

type LokiEntry = [string, string];

export class LokiAuditSink implements AuditSink {
  private readonly url: string;
  private readonly labels: LokiLabels;
  private readonly flushIntervalMs: number;
  private readonly maxBatchSize: number;
  private buffer: LokiEntry[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(url: string, labels: LokiLabels, flushIntervalMs = 2000, maxBatchSize = 200) {
    this.url = url;
    this.labels = labels;
    this.flushIntervalMs = flushIntervalMs;
    this.maxBatchSize = maxBatchSize;
    this.startTimer();
  }

  async write(event: AuditEvent): Promise<void> {
    const timestampNs = `${Date.parse(event.timestamp ?? new Date().toISOString())}000000`;
    const line = JSON.stringify(event);

    this.buffer.push([timestampNs, line]);

    if (this.buffer.length >= this.maxBatchSize) {
      await this.flush();
    }
  }

  async shutdown(): Promise<void> {
    this.stopTimer();
    await this.flush();
  }

  private startTimer(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
  }

  private stopTimer(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      return;
    }

    const batch = this.buffer;
    this.buffer = [];

    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          streams: [
            {
              stream: this.labels,
              values: batch,
            },
          ],
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        console.error("Failed to push audit logs to Loki", {
          status: response.status,
          body: body.slice(0, 200),
        });
      }
    } catch (error) {
      console.error("Failed to push audit logs to Loki", error);
    }
  }
}
