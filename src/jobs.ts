import crypto from "node:crypto";
import type { Job } from "./types.js";

type JobWork<T> = (job: Job) => Promise<T>;

export class JobRunner {
  private readonly jobs = new Map<string, Job>();

  list(): Job[] {
    return [...this.jobs.values()].sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  start<T>(type: string, work: JobWork<T>): Job {
    const job: Job = {
      id: crypto.randomUUID(),
      type,
      status: "queued",
      progress: 0,
      logs: []
    };
    this.jobs.set(job.id, job);

    queueMicrotask(async () => {
      job.status = "running";
      job.startedAt = new Date().toISOString();
      job.logs.push(`Started ${type}`);
      try {
        const result = await work(job);
        job.result = result;
        job.progress = 100;
        job.status = "succeeded";
        job.logs.push(`Completed ${type}`);
      } catch (error) {
        job.status = "failed";
        job.error = error instanceof Error ? error.message : String(error);
        job.logs.push(job.error);
      } finally {
        job.completedAt = new Date().toISOString();
      }
    });

    return job;
  }
}
