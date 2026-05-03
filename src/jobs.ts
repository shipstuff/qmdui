import { randomUUID } from "node:crypto";
import type { JobRecord } from "./types.js";

type JobContext = {
  log: (message: string) => void;
  progress: (value: number) => void;
  isCancelled: () => boolean;
};

type JobHandler<T> = (context: JobContext) => Promise<T>;

export class JobRunner {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly cancelled = new Set<string>();

  list(): JobRecord[] {
    return [...this.jobs.values()].sort((a, b) => {
      const aTime = a.startedAt ?? "";
      const bTime = b.startedAt ?? "";
      return bTime.localeCompare(aTime);
    });
  }

  get(id: string): JobRecord | undefined {
    return this.jobs.get(id);
  }

  start<T>(type: string, handler: JobHandler<T>): JobRecord {
    const id = randomUUID();
    const record: JobRecord = {
      id,
      type,
      status: "queued",
      logs: [],
    };
    this.jobs.set(id, record);

    void this.run(id, handler);
    return record;
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.status === "completed" || job.status === "failed") return false;
    this.cancelled.add(id);
    job.status = "cancelled";
    job.completedAt = new Date().toISOString();
    job.logs.push("Cancellation requested.");
    return true;
  }

  private async run<T>(id: string, handler: JobHandler<T>): Promise<void> {
    const record = this.jobs.get(id);
    if (!record) return;

    record.status = "running";
    record.startedAt = new Date().toISOString();

    const context: JobContext = {
      log: (message) => {
        const line = `${new Date().toISOString()} ${message}`;
        record.logs.push(line);
        console.info(`[job:${record.type}:${id}] ${line}`);
      },
      progress: (value) => {
        record.progress = Math.max(0, Math.min(100, Math.round(value)));
      },
      isCancelled: () => this.cancelled.has(id),
    };

    try {
      const result = await handler(context);
      if (this.cancelled.has(id)) {
        record.status = "cancelled";
      } else {
        record.status = "completed";
        record.result = result;
        record.progress = 100;
      }
    } catch (error) {
      record.status = "failed";
      record.error = error instanceof Error ? error.message : String(error);
      record.logs.push(`Error: ${record.error}`);
      console.error(`[job:${record.type}:${id}] Error: ${record.error}`);
    } finally {
      record.completedAt = new Date().toISOString();
      this.cancelled.delete(id);
    }
  }
}
