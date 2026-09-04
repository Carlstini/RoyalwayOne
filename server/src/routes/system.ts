import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import os from 'node:os';
import { config } from '../lib/config.js';
import { store } from '../lib/db.js';
import { storageStats, cleanupExpired } from '../lib/storage.js';
import { aiAvailable, getAIProvider } from '../services/ai/index.js';
import { transcriptionAvailable, getTranscriptionProvider } from '../services/transcription/index.js';
import { FFMPEG, run } from '../services/media.js';
import { sofficePath } from '../services/convert.js';
import { ytdlpAvailable } from '../services/url-ingest.js';
import { recordEvent } from '../lib/jobs.js';
import { parseBody } from '../lib/validate.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export const systemRouter = Router();

let ffmpegOk: boolean | null = null;
async function checkFfmpeg() {
  if (ffmpegOk !== null) return ffmpegOk;
  try { await run(FFMPEG, ['-version'], { timeoutMs: 15_000 }); ffmpegOk = true; } catch { ffmpegOk = false; }
  return ffmpegOk;
}

systemRouter.get('/health', async (_req, res) => {
  const checks: Record<string, { status: 'ok' | 'degraded' | 'down'; detail?: string }> = {};
  try { await store.ping(); checks.database = { status: 'ok', detail: store.kind }; }
  catch { checks.database = { status: 'down' }; }
  checks.media = { status: (await checkFfmpeg()) ? 'ok' : 'down', detail: 'ffmpeg' };
  checks.storage = { status: 'ok', detail: `${config.retentionMinutes} min retention` };
  checks.ai = { status: aiAvailable() ? 'ok' : 'degraded', detail: aiAvailable() ? getAIProvider().id : 'not configured' };
  checks.transcription = { status: transcriptionAvailable() ? 'ok' : 'degraded', detail: transcriptionAvailable() ? getTranscriptionProvider().id : 'not configured' };
  checks.documents = { status: 'ok', detail: sofficePath() ? 'libreoffice + libraries' : 'libraries' };
  const down = Object.values(checks).some((c) => c.status === 'down');
  res.status(down ? 503 : 200).json({
    ok: !down,
    status: down ? 'unhealthy' : 'healthy',
    version: process.env.npm_package_version ?? '1.0.0',
    uptimeSeconds: Math.round(process.uptime()),
    checks,
  });
});

systemRouter.get('/capabilities', async (_req, res) => {
  res.json({
    ok: true,
    ai: aiAvailable(),
    transcription: transcriptionAvailable(),
    urlPlatformSupport: await ytdlpAvailable(),
    officeConversion: !!sofficePath(),
    limits: {
      maxUploadBytes: config.maxUploadBytes,
      maxMediaSeconds: config.maxMediaSeconds,
      retentionMinutes: config.retentionMinutes,
    },
  });
});

const eventSchema = z.object({ name: z.string().max(60), props: z.record(z.any()).optional() });
const ALLOWED_EVENTS = new Set(['tool_opened', 'category_opened', 'search_performed', 'download_clicked', 'intro_seen', 'workflow_opened']);

systemRouter.post('/analytics/event', async (req, res, next) => {
  try {
    const body = parseBody(eventSchema, req);
    if (!ALLOWED_EVENTS.has(body.name)) return res.json({ ok: true, ignored: true });
    // Anonymous only: no identifiers, no IPs, no personal data.
    await recordEvent(body.name, sanitiseProps(body.props ?? {}));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

function sanitiseProps(props: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props).slice(0, 8)) {
    if (typeof v === 'string') out[k] = v.slice(0, 80);
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  return out;
}

/** Admin is opt-in: without ADMIN_TOKEN configured the endpoints stay closed. */
function requireAdmin(req: any) {
  if (!config.adminToken) throw new AppError('The admin dashboard is not enabled.', 404, 'NOT_FOUND');
  const provided = String(req.headers['x-admin-token'] ?? req.query.token ?? '');
  const a = Buffer.from(provided.padEnd(64).slice(0, 64));
  const b = Buffer.from(config.adminToken.padEnd(64).slice(0, 64));
  if (!crypto.timingSafeEqual(a, b)) throw new AppError('Not authorised.', 401, 'UNAUTHORISED');
}

systemRouter.get('/admin/overview', async (req, res, next) => {
  try {
    requireAdmin(req);
    const [jobs, events, storage] = await Promise.all([store.listJobs(200), store.listEvents(500), storageStats()]);
    const byStatus = jobs.reduce<Record<string, number>>((acc, j) => { acc[j.status] = (acc[j.status] ?? 0) + 1; return acc; }, {});
    const byTool = jobs.reduce<Record<string, number>>((acc, j) => {
      const key = j.params?.toolId ?? j.params?.workflowId ?? j.tool;
      acc[key] = (acc[key] ?? 0) + 1; return acc;
    }, {});
    const durations = jobs.filter((j) => j.status === 'succeeded').map((j) => j.updated_at - j.created_at);
    res.json({
      ok: true,
      system: {
        uptimeSeconds: Math.round(process.uptime()),
        memoryMb: Math.round(process.memoryUsage().rss / 1e6),
        loadAverage: os.loadavg().map((n) => Math.round(n * 100) / 100),
        database: store.kind,
        env: config.env,
      },
      providers: {
        ai: { configured: aiAvailable(), provider: getAIProvider().id, model: getAIProvider().model },
        transcription: { configured: transcriptionAvailable(), provider: getTranscriptionProvider().id },
        media: { ffmpeg: await checkFfmpeg() },
        office: !!sofficePath(),
      },
      jobs: {
        total: jobs.length,
        byStatus,
        byTool,
        averageMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
        recent: jobs.slice(0, 40).map((j) => ({
          id: j.id, tool: j.params?.toolId ?? j.params?.workflowId ?? j.tool, status: j.status,
          stage: j.stage, error: j.error, createdAt: j.created_at, durationMs: j.updated_at - j.created_at,
        })),
        failures: jobs.filter((j) => j.status === 'failed').slice(0, 20).map((j) => ({ id: j.id, tool: j.params?.toolId ?? j.tool, error: j.error, at: j.updated_at })),
      },
      storage,
      usage: events.reduce<Record<string, number>>((acc, e) => { acc[e.name] = (acc[e.name] ?? 0) + 1; return acc; }, {}),
    });
  } catch (err) { next(err); }
});

systemRouter.post('/admin/cleanup', async (req, res, next) => {
  try {
    requireAdmin(req);
    const removed = await cleanupExpired();
    const purged = await store.purgeBefore(Date.now() - config.retentionMinutes * 60_000);
    logger.info({ removed, purged }, 'manual cleanup');
    res.json({ ok: true, filesRemoved: removed, jobsPurged: purged });
  } catch (err) { next(err); }
});
