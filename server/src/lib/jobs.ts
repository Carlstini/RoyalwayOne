/**
 * Job queue. Jobs are persisted (Postgres or local store) and executed by an
 * in-process worker loop; the same loop runs in the optional standalone worker
 * service on Render. Postgres uses SKIP LOCKED so multiple workers are safe.
 */
import crypto from 'node:crypto';
import { store, type JobRecord, type JobStatus } from './db.js';
import { logger } from './logger.js';
import { config } from './config.js';
import { AppError } from './errors.js';

export interface JobContext {
  job: JobRecord;
  setStage(stage: string): Promise<void>;
}

export type JobHandler = (ctx: JobContext) => Promise<unknown>;

const handlers = new Map<string, JobHandler>();
export function registerJobHandler(tool: string, handler: JobHandler) {
  handlers.set(tool, handler);
}
export function hasJobHandler(tool: string) { return handlers.has(tool); }

export async function enqueueJob(opts: {
  sessionId: string;
  tool: string;
  params?: Record<string, unknown>;
  inputFileIds?: string[];
}): Promise<JobRecord> {
  const active = await store.countJobs(opts.sessionId, ['queued', 'running']);
  if (active >= config.maxConcurrentJobsPerSession) {
    throw new AppError('You already have several jobs running. Please wait for those to finish first.', 429, 'TOO_MANY_JOBS');
  }
  const now = Date.now();
  const job: JobRecord = {
    id: crypto.randomBytes(16).toString('hex'),
    session_id: opts.sessionId,
    tool: opts.tool,
    status: 'queued',
    stage: 'queued',
    params: opts.params ?? {},
    input_file_ids: opts.inputFileIds ?? [],
    result: null,
    error: null,
    created_at: now,
    updated_at: now,
  };
  await store.createJob(job);
  notify();
  return job;
}

export async function getJob(id: string) {
  return store.getJob(id);
}

let running = 0;
let stopped = false;
let wake: (() => void) | null = null;

function notify() { wake?.(); }

async function waitForWork(ms: number) {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => { wake = null; resolve(); }, ms);
    wake = () => { clearTimeout(timer); wake = null; resolve(); };
  });
}

export function startWorker() {
  stopped = false;
  void loop();
  logger.info({ concurrency: config.workerConcurrency }, 'job worker started');
}

export function stopWorker() { stopped = true; notify(); }

async function loop() {
  while (!stopped) {
    if (running >= config.workerConcurrency) { await waitForWork(250); continue; }
    let job: JobRecord | null = null;
    try {
      job = await store.claimNextJob();
    } catch (err) {
      logger.error({ err }, 'failed to claim job');
    }
    if (!job) { await waitForWork(1000); continue; }
    running++;
    void execute(job).finally(() => { running--; notify(); });
  }
}

async function execute(job: JobRecord) {
  const handler = handlers.get(job.tool);
  const started = Date.now();
  if (!handler) {
    await finish(job.id, 'failed', null, 'This tool is not available on this server.');
    return;
  }
  const ctx: JobContext = {
    job,
    async setStage(stage) { await store.updateJob(job.id, { stage }); },
  };
  try {
    await store.updateJob(job.id, { status: 'running', stage: 'processing' });
    const result = await handler(ctx);
    await finish(job.id, 'succeeded', result, null);
    logger.info({ tool: job.tool, ms: Date.now() - started }, 'job succeeded');
    void recordEvent('processing_completed', { tool: job.tool, ms: Date.now() - started });
  } catch (err) {
    const message = err instanceof AppError ? err.message : 'Something went wrong while processing your file. Please try again.';
    logger.error({ err, tool: job.tool }, 'job failed');
    await finish(job.id, 'failed', null, message);
    void recordEvent('processing_failed', { tool: job.tool, code: err instanceof AppError ? err.code : 'INTERNAL' });
  }
}

async function finish(id: string, status: JobStatus, result: unknown, error: string | null) {
  await store.updateJob(id, { status, stage: status === 'succeeded' ? 'done' : 'failed', result: result as any, error });
}

export async function recordEvent(name: string, props: Record<string, unknown> = {}) {
  try {
    await store.recordEvent({ id: crypto.randomBytes(12).toString('hex'), name, props, created_at: Date.now() });
  } catch (err) {
    logger.debug({ err }, 'analytics event dropped');
  }
}
