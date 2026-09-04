import { Router } from 'express';
import { z } from 'zod';
import { allTools, categories, getTool, searchTools, serializeTool, suggestForFiles } from '../tools/registry.js';
import { workflows, getWorkflow } from '../tools/workflows.js';
import { runToolNow } from '../tools/runner.js';
import { enqueueJob, getJob, recordEvent } from '../lib/jobs.js';
import { parseBody, fileIdSchema } from '../lib/validate.js';
import { notFound, AppError } from '../lib/errors.js';
import { processLimiter, aiLimiter } from '../lib/rate-limit.js';
import { aiAvailable } from '../services/ai/index.js';
import { transcriptionAvailable } from '../services/transcription/index.js';

export const toolsRouter = Router();

toolsRouter.get('/tools', (_req, res) => {
  res.json({
    ok: true,
    categories,
    tools: allTools.map(serializeTool),
    workflows: workflows.map((w) => ({
      ...w,
      available: (!w.requires?.includes('ai') || aiAvailable()) && (!w.requires?.includes('transcription') || transcriptionAvailable()),
    })),
    capabilities: { ai: aiAvailable(), transcription: transcriptionAvailable() },
  });
});

toolsRouter.get('/tools/search', (req, res) => {
  res.json({ ok: true, results: searchTools(String(req.query.q ?? ''), Number(req.query.limit ?? 12)) });
});

toolsRouter.post('/tools/suggest', (req, res) => {
  const files = Array.isArray(req.body?.files) ? req.body.files : [];
  res.json({ ok: true, suggestions: suggestForFiles(files.map((f: any) => ({ name: String(f.name ?? ''), mime: String(f.mime ?? '') }))) });
});

toolsRouter.get('/tools/:id', (req, res) => {
  const tool = getTool(req.params.id);
  if (!tool) throw notFound('That tool is not available.');
  res.json({ ok: true, tool: serializeTool(tool) });
});

const runSchema = z.object({
  toolId: z.string().min(1),
  fileIds: z.array(fileIdSchema).max(60).default([]),
  params: z.record(z.any()).default({}),
  async: z.boolean().optional(),
});

toolsRouter.post('/tools/run', processLimiter, async (req, res, next) => {
  try {
    const body = parseBody(runSchema, req);
    const tool = getTool(body.toolId);
    if (!tool) throw notFound('That tool is not available.');
    if (tool.requires?.includes('ai')) await new Promise<void>((resolve, reject) => aiLimiter(req, res, (e?: any) => (e ? reject(e) : resolve())));

    void recordEvent('processing_started', { tool: tool.id, category: tool.category });

    // Heavy work runs as a background job so the request never blocks.
    if (tool.heavy || body.async) {
      const job = await enqueueJob({
        sessionId: req.sessionId,
        tool: 'tool',
        params: { toolId: tool.id, params: body.params ?? {} },
        inputFileIds: body.fileIds ?? [],
      });
      return res.status(202).json({ ok: true, mode: 'job', job: publicJob(job) });
    }

    const result = await runToolNow({ toolId: tool.id, sessionId: req.sessionId, fileIds: body.fileIds ?? [], params: body.params ?? {} });
    void recordEvent('processing_completed', { tool: tool.id });
    res.json({ ok: true, mode: 'sync', result });
  } catch (err) { next(err); }
});

const workflowSchema = z.object({
  workflowId: z.string().min(1),
  fileIds: z.array(fileIdSchema).min(1).max(10),
  params: z.record(z.any()).optional(),
});

toolsRouter.post('/workflows/run', processLimiter, async (req, res, next) => {
  try {
    const body = parseBody(workflowSchema, req);
    const workflow = getWorkflow(body.workflowId);
    if (!workflow) throw notFound('That workflow is not available.');
    if (workflow.requires?.includes('ai') && !aiAvailable()) throw new AppError('AI features are not switched on for this deployment yet.', 503, 'NOT_CONFIGURED');
    if (workflow.requires?.includes('transcription') && !transcriptionAvailable()) throw new AppError('Transcription is not switched on for this deployment yet.', 503, 'NOT_CONFIGURED');
    const job = await enqueueJob({ sessionId: req.sessionId, tool: 'workflow', params: { workflowId: workflow.id, params: body.params ?? {} }, inputFileIds: body.fileIds });
    void recordEvent('workflow_started', { workflow: workflow.id });
    res.status(202).json({ ok: true, mode: 'job', job: publicJob(job) });
  } catch (err) { next(err); }
});

toolsRouter.get('/jobs/:id', async (req, res, next) => {
  try {
    const job = await getJob(req.params.id);
    if (!job || job.session_id !== req.sessionId) throw notFound('We could not find that job.');
    res.json({ ok: true, job: publicJob(job) });
  } catch (err) { next(err); }
});

function publicJob(job: any) {
  return {
    id: job.id,
    tool: job.params?.toolId ?? job.params?.workflowId ?? job.tool,
    status: job.status,
    stage: job.stage,
    result: job.status === 'succeeded' ? job.result : undefined,
    error: job.error ?? undefined,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
}
