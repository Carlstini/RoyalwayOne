import fs from 'node:fs/promises';
import { requireTranscription } from '../services/transcription/index.js';
import { extractSpeechAudio, probe } from '../services/media.js';
import { ingestMediaUrl } from '../services/url-ingest.js';
import { saveTranscript } from '../services/transcript-store.js';
import { config } from '../lib/config.js';
import { AppError } from '../lib/errors.js';
import { runTask } from '../services/ai/tasks.js';
import { aiAvailable } from '../services/ai/index.js';
import type { ToolDefinition, ToolRunContext } from './types.js';

const MEDIA_ACCEPT = ['audio/*', 'video/*', '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.opus', '.flac', '.mp4', '.mov', '.webm', '.mkv', '.avi'];

const LANGUAGES = [
  { value: '', label: 'Detect automatically' }, { value: 'en', label: 'English' }, { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' }, { value: 'de', label: 'German' }, { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' }, { value: 'nl', label: 'Dutch' }, { value: 'sv', label: 'Swedish' },
  { value: 'pl', label: 'Polish' }, { value: 'hi', label: 'Hindi' }, { value: 'ja', label: 'Japanese' },
  { value: 'zh', label: 'Chinese' }, { value: 'ar', label: 'Arabic' },
];

async function transcribeFromPath(ctx: ToolRunContext, sourcePath: string, title: string, sourceId: string) {
  const provider = requireTranscription();
  await ctx.setStage('preparing audio');
  const info = await probe(sourcePath);
  if (!info.hasAudio) throw new AppError('We could not find an audio track in this file.', 422, 'NO_AUDIO');
  if (info.durationSeconds > config.maxMediaSeconds) {
    throw new AppError(`Recordings up to ${Math.round(config.maxMediaSeconds / 60)} minutes can be transcribed here. Please trim the file and try again.`, 413, 'TOO_LONG');
  }
  const audioPath = await extractSpeechAudio(sourcePath);
  try {
    const result = await provider.transcribeFile(audioPath, {
      language: ctx.params.language || undefined,
      diarize: ctx.params.diarize !== false,
      mimeType: 'audio/wav',
      onStage: (s) => { void ctx.setStage(s); },
    });
    if (!result.text.trim()) throw new AppError('We could not find any speech in this recording.', 422, 'NO_SPEECH');

    saveTranscript({
      id: sourceId,
      sessionId: ctx.sessionId,
      title,
      segments: result.segments,
      text: result.text,
      language: result.language,
      durationSeconds: result.durationSeconds ?? info.durationSeconds,
      speakerCount: result.speakerCount,
      provider: result.provider,
    });

    let analysis: Record<string, string> | undefined;
    if (ctx.params.analyse && aiAvailable()) {
      await ctx.setStage('analysing');
      analysis = {};
      for (const task of ['executive-summary', 'key-points', 'action-items'] as const) {
        try { analysis[task] = (await runTask(task, result.text)).output; } catch { /* analysis is best-effort */ }
      }
    }

    return {
      data: {
        transcriptId: sourceId,
        title,
        text: result.text,
        segments: result.segments,
        language: result.language,
        durationSeconds: result.durationSeconds ?? info.durationSeconds,
        speakerCount: result.speakerCount,
        provider: result.provider,
        analysis,
      },
      stats: {
        durationSeconds: Math.round(result.durationSeconds ?? info.durationSeconds),
        words: result.text.split(/\s+/).filter(Boolean).length,
        speakers: result.speakerCount ?? null,
        language: result.language ?? 'detected',
      },
    };
  } finally {
    await fs.rm(audioPath, { force: true });
  }
}

export const transcribeTools: ToolDefinition[] = [
  {
    id: 'transcribe-file',
    name: 'Transcribe audio or video',
    category: 'transcribe',
    description: 'Turn a recording into an accurate, timestamped transcript you can edit and export.',
    icon: 'waveform',
    route: '/transcribe',
    keywords: ['transcribe', 'transcription', 'speech to text', 'audio to text', 'video to text', 'subtitles', 'meeting notes'],
    accept: MEDIA_ACCEPT, minFiles: 1, maxFiles: 1, heavy: true, requires: ['transcription'], outputKind: 'transcript',
    fields: [
      { key: 'language', label: 'Spoken language', type: 'select', default: '', options: LANGUAGES },
      { key: 'diarize', label: 'Identify different speakers', type: 'toggle', default: true },
      { key: 'analyse', label: 'Add an AI summary and action items', type: 'toggle', default: true },
    ],
    async run(ctx) {
      const file = ctx.files[0];
      return transcribeFromPath(ctx, file.path, file.name, file.id);
    },
  },
  {
    id: 'transcribe-url',
    name: 'Transcribe from a link',
    category: 'transcribe',
    description: 'Paste a public audio or video link and get a transcript back.',
    icon: 'link',
    route: '/transcribe/url',
    keywords: ['transcribe url', 'transcribe link', 'podcast transcript', 'video link transcript'],
    accept: [], minFiles: 0, maxFiles: 0, heavy: true, requires: ['transcription'], outputKind: 'transcript',
    fields: [
      { key: 'url', label: 'Media link', type: 'text', placeholder: 'https://example.com/episode.mp3' },
      { key: 'language', label: 'Spoken language', type: 'select', default: '', options: LANGUAGES },
      { key: 'diarize', label: 'Identify different speakers', type: 'toggle', default: true },
      { key: 'analyse', label: 'Add an AI summary and action items', type: 'toggle', default: true },
    ],
    async run(ctx) {
      const url = String(ctx.params.url ?? '').trim();
      if (!url) throw new AppError('Paste the link you want to transcribe.', 400, 'BAD_REQUEST');
      requireTranscription();
      await ctx.setStage('fetching media');
      const ingest = await ingestMediaUrl(url, { onStage: (s) => { void ctx.setStage(s); } });
      try {
        const result = await transcribeFromPath(ctx, ingest.path, ingest.title, `url-${Date.now().toString(36)}`);
        return { ...result, stats: { ...result.stats, source: ingest.sourceType } };
      } finally {
        await fs.rm(ingest.path, { force: true });
      }
    },
  },
];
