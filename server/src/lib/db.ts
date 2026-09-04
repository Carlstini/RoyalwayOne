/**
 * Persistence layer.
 * Uses PostgreSQL when DATABASE_URL is set (Render production), otherwise a
 * durable local JSON store so the app runs with zero configuration in dev.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { config } from './config.js';
import { logger } from './logger.js';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface JobRecord {
  id: string;
  session_id: string;
  tool: string;
  status: JobStatus;
  stage: string;
  params: any;
  input_file_ids: string[];
  result: any;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export interface EventRecord { id: string; name: string; props: any; created_at: number }

interface Store {
  kind: 'postgres' | 'local';
  init(): Promise<void>;
  createJob(j: JobRecord): Promise<void>;
  updateJob(id: string, patch: Partial<JobRecord>): Promise<void>;
  getJob(id: string): Promise<JobRecord | null>;
  claimNextJob(): Promise<JobRecord | null>;
  listJobs(limit?: number): Promise<JobRecord[]>;
  countJobs(sessionId: string, statuses: JobStatus[]): Promise<number>;
  recordEvent(e: EventRecord): Promise<void>;
  listEvents(limit?: number): Promise<EventRecord[]>;
  purgeBefore(ts: number): Promise<number>;
  ping(): Promise<boolean>;
}

let pool: pg.Pool | null = null;

const pgStore: Store = {
  kind: 'postgres',
  async init() {
    pool = new pg.Pool({
      connectionString: config.databaseUrl,
      ssl: /localhost|127\.0\.0\.1/.test(config.databaseUrl) ? undefined : { rejectUnauthorized: false },
      max: 5,
    });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        tool TEXT NOT NULL,
        status TEXT NOT NULL,
        stage TEXT NOT NULL DEFAULT '',
        params JSONB NOT NULL DEFAULT '{}',
        input_file_ids JSONB NOT NULL DEFAULT '[]',
        result JSONB,
        error TEXT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status, created_at);
      CREATE INDEX IF NOT EXISTS jobs_session_idx ON jobs(session_id);
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        props JSONB NOT NULL DEFAULT '{}',
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_created_idx ON events(created_at);
    `);
  },
  async createJob(j) {
    await pool!.query(
      `INSERT INTO jobs (id,session_id,tool,status,stage,params,input_file_ids,result,error,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [j.id, j.session_id, j.tool, j.status, j.stage, j.params, JSON.stringify(j.input_file_ids), j.result, j.error, j.created_at, j.updated_at],
    );
  },
  async updateJob(id, patch) {
    const fields: string[] = [];
    const values: any[] = [];
    for (const [k, v] of Object.entries(patch)) {
      values.push(k === 'params' || k === 'result' ? v : k === 'input_file_ids' ? JSON.stringify(v) : v);
      fields.push(`${k}=$${values.length}`);
    }
    values.push(Date.now());
    fields.push(`updated_at=$${values.length}`);
    values.push(id);
    await pool!.query(`UPDATE jobs SET ${fields.join(',')} WHERE id=$${values.length}`, values);
  },
  async getJob(id) {
    const r = await pool!.query('SELECT * FROM jobs WHERE id=$1', [id]);
    return r.rows[0] ? normalize(r.rows[0]) : null;
  },
  async claimNextJob() {
    const r = await pool!.query(
      `UPDATE jobs SET status='running', updated_at=$1
       WHERE id = (SELECT id FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
       RETURNING *`,
      [Date.now()],
    );
    return r.rows[0] ? normalize(r.rows[0]) : null;
  },
  async listJobs(limit = 100) {
    const r = await pool!.query('SELECT * FROM jobs ORDER BY created_at DESC LIMIT $1', [limit]);
    return r.rows.map(normalize);
  },
  async countJobs(sessionId, statuses) {
    const r = await pool!.query('SELECT COUNT(*)::int AS c FROM jobs WHERE session_id=$1 AND status = ANY($2)', [sessionId, statuses]);
    return r.rows[0].c as number;
  },
  async recordEvent(e) {
    await pool!.query('INSERT INTO events (id,name,props,created_at) VALUES ($1,$2,$3,$4)', [e.id, e.name, e.props, e.created_at]);
  },
  async listEvents(limit = 500) {
    const r = await pool!.query('SELECT * FROM events ORDER BY created_at DESC LIMIT $1', [limit]);
    return r.rows.map((x: any) => ({ ...x, created_at: Number(x.created_at) }));
  },
  async purgeBefore(ts) {
    const a = await pool!.query('DELETE FROM jobs WHERE created_at < $1', [ts]);
    await pool!.query('DELETE FROM events WHERE created_at < $1', [ts - 7 * 24 * 3600_000]);
    return a.rowCount ?? 0;
  },
  async ping() {
    await pool!.query('SELECT 1');
    return true;
  },
};

function normalize(row: any): JobRecord {
  return {
    ...row,
    input_file_ids: typeof row.input_file_ids === 'string' ? JSON.parse(row.input_file_ids) : row.input_file_ids,
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
  };
}

/** Local JSON store — single-process, good enough for dev and small deployments. */
function makeLocalStore(): Store {
  const file = () => path.join(config.storageDir, 'db.json');
  let data: { jobs: Record<string, JobRecord>; events: EventRecord[] } = { jobs: {}, events: [] };
  let writing: Promise<void> = Promise.resolve();
  const flush = () => {
    writing = writing.then(() => fs.writeFile(file(), JSON.stringify(data)).catch(() => {}));
    return writing;
  };
  return {
    kind: 'local',
    async init() {
      await fs.mkdir(config.storageDir, { recursive: true });
      try { data = JSON.parse(await fs.readFile(file(), 'utf8')); } catch { /* fresh store */ }
      for (const j of Object.values(data.jobs)) if (j.status === 'running') j.status = 'queued';
    },
    async createJob(j) { data.jobs[j.id] = j; await flush(); },
    async updateJob(id, patch) {
      const j = data.jobs[id];
      if (j) { Object.assign(j, patch, { updated_at: Date.now() }); await flush(); }
    },
    async getJob(id) { return data.jobs[id] ?? null; },
    async claimNextJob() {
      const next = Object.values(data.jobs).filter((j) => j.status === 'queued').sort((a, b) => a.created_at - b.created_at)[0];
      if (!next) return null;
      next.status = 'running';
      next.updated_at = Date.now();
      await flush();
      return next;
    },
    async listJobs(limit = 100) {
      return Object.values(data.jobs).sort((a, b) => b.created_at - a.created_at).slice(0, limit);
    },
    async countJobs(sessionId, statuses) {
      return Object.values(data.jobs).filter((j) => j.session_id === sessionId && statuses.includes(j.status)).length;
    },
    async recordEvent(e) { data.events.unshift(e); data.events = data.events.slice(0, 5000); await flush(); },
    async listEvents(limit = 500) { return data.events.slice(0, limit); },
    async purgeBefore(ts) {
      let n = 0;
      for (const [id, j] of Object.entries(data.jobs)) if (j.created_at < ts) { delete data.jobs[id]; n++; }
      await flush();
      return n;
    },
    async ping() { return true; },
  };
}

export let store: Store = makeLocalStore();

export async function initDb() {
  if (config.databaseUrl) {
    try {
      store = pgStore;
      await store.init();
      logger.info('database: postgres');
      return;
    } catch (err) {
      logger.error({ err }, 'postgres init failed, falling back to local store');
    }
  }
  store = makeLocalStore();
  await store.init();
  logger.info('database: local json store');
}
