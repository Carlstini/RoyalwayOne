import { Router } from 'express';
import { z } from 'zod';
import { parseBody, fileIdSchema } from '../lib/validate.js';
import { processLimiter } from '../lib/rate-limit.js';
import { enqueueJob } from '../lib/jobs.js';
import { getTranscript, updateTranscript } from '../services/transcript-store.js';
import { getDocumentContext } from '../services/document-store.js';
import { transcriptionAvailable } from '../services/transcription/index.js';
import { ytdlpAvailable } from '../services/url-ingest.js';
import * as exporters from '../services/transcript-export.js';
import { AppError, notFound } from '../lib/errors.js';
import { chunkText } from '../services/ai/retrieval.js';

export const transcriptionRouter = Router();

transcriptionRouter.get('/transcription/status', async (_req, res) => {
  res.json({ ok: true, available: transcriptionAvailable(), urlPlatformSupport: await ytdlpAvailable() });
});

transcriptionRouter.post('/transcription', processLimiter, async (req, res, next) => {
  try {
    const body = parseBody(z.object({
      fileId: fileIdSchema,
      language: z.string().max(10).optional(),
      diarize: z.boolean().optional(),
      analyse: z.boolean().optional(),
    }), req);
    if (!transcriptionAvailable()) throw new AppError('Transcription is not switched on for this deployment yet.', 503, 'NOT_CONFIGURED');
    const job = await enqueueJob({
      sessionId: req.sessionId,
      tool: 'tool',
      params: { toolId: 'transcribe-file', params: { language: body.language ?? '', diarize: body.diarize ?? true, analyse: body.analyse ?? true } },
      inputFileIds: [body.fileId],
    });
    res.status(202).json({ ok: true, job: { id: job.id, status: job.status, stage: job.stage } });
  } catch (err) { next(err); }
});

transcriptionRouter.post('/transcription/url', processLimiter, async (req, res, next) => {
  try {
    const body = parseBody(z.object({
      url: z.string().url('must be a valid link'),
      language: z.string().max(10).optional(),
      diarize: z.boolean().optional(),
      analyse: z.boolean().optional(),
    }), req);
    if (!transcriptionAvailable()) throw new AppError('Transcription is not switched on for this deployment yet.', 503, 'NOT_CONFIGURED');
    const job = await enqueueJob({
      sessionId: req.sessionId,
      tool: 'tool',
      params: { toolId: 'transcribe-url', params: { url: body.url, language: body.language ?? '', diarize: body.diarize ?? true, analyse: body.analyse ?? true } },
      inputFileIds: [],
    });
    res.status(202).json({ ok: true, job: { id: job.id, status: job.status, stage: job.stage } });
  } catch (err) { next(err); }
});

transcriptionRouter.get('/transcription/:id', (req, res, next) => {
  try {
    const t = getTranscript(req.params.id, req.sessionId);
    if (!t) throw notFound('That transcript is no longer available.');
    res.json({ ok: true, transcript: t });
  } catch (err) { next(err); }
});

transcriptionRouter.put('/transcription/:id', (req, res, next) => {
  try {
    const body = parseBody(z.object({
      segments: z.array(z.object({ start: z.number(), end: z.number(), text: z.string().max(20_000), speaker: z.string().max(80).optional() })).max(20_000),
    }), req);
    const t = updateTranscript(req.params.id, req.sessionId, body.segments);
    if (!t) throw notFound('That transcript is no longer available.');
    res.json({ ok: true, transcript: t });
  } catch (err) { next(err); }
});

const EXPORTS = ['txt', 'md', 'srt', 'vtt', 'docx', 'pdf'] as const;

transcriptionRouter.get('/transcription/:id/export/:format', async (req, res, next) => {
  try {
    const format = req.params.format as (typeof EXPORTS)[number];
    if (!EXPORTS.includes(format)) throw new AppError('That export format is not supported.', 400, 'BAD_REQUEST');
    const t = getTranscript(req.params.id, req.sessionId);
    if (!t) throw notFound('That transcript is no longer available.');
    const timestamps = req.query.timestamps !== '0';
    const speakers = req.query.speakers !== '0';
    const safeTitle = t.title.replace(/\.[^.]+$/, '').replace(/[^\w.\- ]+/g, '_') || 'transcript';

    let body: Buffer | string;
    let mime: string;
    let ext: string = format;
    switch (format) {
      case 'txt': body = exporters.toPlainText(t.segments, { timestamps, speakers }); mime = 'text/plain; charset=utf-8'; break;
      case 'md': body = exporters.toMarkdown(t.title, t.segments); mime = 'text/markdown; charset=utf-8'; break;
      case 'srt': body = exporters.toSrt(t.segments); mime = 'application/x-subrip'; break;
      case 'vtt': body = exporters.toVtt(t.segments); mime = 'text/vtt'; break;
      case 'docx': body = await exporters.toDocx(t.title, t.segments, { timestamps, speakers }); mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; break;
      case 'pdf': body = exporters.toPdf(t.title, t.segments, { timestamps, speakers }); mime = 'application/pdf'; break;
    }
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.${ext}"`);
    res.send(body);
  } catch (err) { next(err); }
});

/** Used by /ai/chat when the question targets a transcript rather than a file. */
export function getCachedTranscript(id: string, sessionId: string) {
  const t = getTranscript(id, sessionId);
  if (!t) throw notFound('That transcript is no longer available.');
  const pages = t.segments.length
    ? groupSegments(t.segments)
    : [{ label: 'Transcript', text: t.text }];
  return { chunks: chunkText(pages), title: t.title };
}

function groupSegments(segments: { start: number; text: string; speaker?: string }[]) {
  const pages: { label: string; text: string }[] = [];
  for (let i = 0; i < segments.length; i += 25) {
    const group = segments.slice(i, i + 25);
    pages.push({
      label: `${clock(group[0].start)}–${clock(group[group.length - 1].start)}`,
      text: group.map((s) => `${s.speaker ? `${s.speaker}: ` : ''}${s.text}`).join('\n'),
    });
  }
  return pages;
}
const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export { getDocumentContext };
