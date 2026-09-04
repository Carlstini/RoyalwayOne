import { Router } from 'express';
import { z } from 'zod';
import { parseBody, fileIdSchema } from '../lib/validate.js';
import { aiLimiter } from '../lib/rate-limit.js';
import { resolveFiles } from '../tools/runner.js';
import { getDocumentContext } from '../services/document-store.js';
import { retrieve } from '../services/ai/retrieval.js';
import { answerFromContext, freeformChat, runTask, extractEntities, compareDocuments, AI_TASKS, type AiTaskId } from '../services/ai/tasks.js';
import { aiAvailable } from '../services/ai/index.js';
import { AppError } from '../lib/errors.js';
import { textDiff } from '../tools/ai-tools.js';
import { recordEvent } from '../lib/jobs.js';

export const aiRouter = Router();

aiRouter.use(aiLimiter);

aiRouter.get('/ai/status', (_req, res) => {
  res.json({ ok: true, available: aiAvailable(), tasks: Object.entries(AI_TASKS).map(([id, t]) => ({ id, label: t.label })) });
});

const textSourceSchema = z.object({
  fileId: fileIdSchema.optional(),
  documentId: z.string().max(80).optional(),
  text: z.string().max(400_000).optional(),
});

async function resolveText(req: any, body: z.infer<typeof textSourceSchema>) {
  if (body.text?.trim()) return { text: body.text.trim(), label: 'Pasted text' };
  if (body.fileId) {
    const [file] = await resolveFiles(req.sessionId, [body.fileId]);
    const { doc } = await getDocumentContext(file);
    return { text: doc.text, label: file.name };
  }
  throw new AppError('Upload a document or paste some text first.', 400, 'BAD_REQUEST');
}

aiRouter.post('/ai/:task(summarize|summary|key-points|action-items|decisions|topics|questions|meeting-minutes|follow-up-email|explain|executive-summary|important-moments|swot|presentation-outline|project-brief|decision-log|proposal-analysis|policy-summary|document-review|job-description|report-summary)', async (req, res, next) => {
  try {
    const taskId = (req.params.task === 'summarize' ? 'summary' : req.params.task) as AiTaskId;
    const body = parseBody(textSourceSchema.extend({ instruction: z.string().max(2000).optional() }), req);
    const src = await resolveText(req, body);
    const result = await runTask(taskId, src.text, body.instruction);
    void recordEvent('ai_task', { task: taskId });
    res.json({ ok: true, task: taskId, output: result.output, source: src.label, truncated: result.truncated });
  } catch (err) { next(err); }
});

aiRouter.post('/ai/extract', async (req, res, next) => {
  try {
    const body = parseBody(textSourceSchema, req);
    const src = await resolveText(req, body);
    const { data, truncated } = await extractEntities(src.text);
    void recordEvent('ai_task', { task: 'extract' });
    res.json({ ok: true, data, source: src.label, truncated });
  } catch (err) { next(err); }
});

aiRouter.post('/ai/compare', async (req, res, next) => {
  try {
    const body = parseBody(z.object({ fileIds: z.array(fileIdSchema).length(2) }), req);
    const files = await resolveFiles(req.sessionId, body.fileIds);
    const [a, b] = await Promise.all(files.map((f) => getDocumentContext(f)));
    const { output, truncated } = await compareDocuments({ name: files[0].name, text: a.doc.text }, { name: files[1].name, text: b.doc.text });
    const diff = textDiff(a.doc.text, b.doc.text);
    void recordEvent('ai_task', { task: 'compare' });
    res.json({ ok: true, output, diff, truncated, documents: files.map((f) => f.name) });
  } catch (err) { next(err); }
});

const chatSchema = z.object({
  fileId: fileIdSchema.optional(),
  transcriptId: z.string().max(80).optional(),
  question: z.string().min(1).max(4000),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(8000) })).max(20).default([]),
});

aiRouter.post('/ai/chat', async (req, res, next) => {
  try {
    const body = parseBody(chatSchema, req);
    if (!body.fileId && !body.transcriptId) {
      const answer = await freeformChat([...(body.history ?? []), { role: 'user', content: body.question }]);
      return res.json({ ok: true, answer, grounded: false, sources: [] });
    }
    let chunks; let name: string;
    if (body.fileId) {
      const [file] = await resolveFiles(req.sessionId, [body.fileId]);
      const entry = await getDocumentContext(file);
      chunks = entry.chunks; name = file.name;
    } else {
      const { getCachedTranscript } = await import('./transcription.js');
      const entry = getCachedTranscript(body.transcriptId!, req.sessionId);
      chunks = entry.chunks; name = entry.title;
    }
    const relevant = await retrieve(body.question, chunks, 8);
    const answer = await answerFromContext(body.question, relevant.map((c) => ({ label: c.label, text: c.text })), body.history);
    void recordEvent('ai_task', { task: 'chat' });
    res.json({ ok: true, answer, grounded: true, document: name, sources: relevant.map((c) => ({ label: c.label, excerpt: c.text.slice(0, 320) })) });
  } catch (err) { next(err); }
});
