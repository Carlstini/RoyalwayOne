import 'dotenv/config';
import path from 'node:path';

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: num(process.env.PORT, 8080),
  publicUrl: process.env.PUBLIC_URL ?? '',
  storageDir: process.env.STORAGE_DIR ?? path.resolve(process.cwd(), '.storage'),
  databaseUrl: process.env.DATABASE_URL ?? '',
  sessionSecret: process.env.SESSION_SECRET ?? 'royalway-dev-secret-change-me',
  adminToken: process.env.ADMIN_TOKEN ?? '',
  /** Who may embed the app in a frame. Defaults to same-origin only in production. */
  frameAncestors: (process.env.FRAME_ANCESTORS ?? (process.env.NODE_ENV === 'production' ? "'self'" : "'self' https:"))
    .split(/\s+/).filter(Boolean),
  retentionMinutes: num(process.env.FILE_RETENTION_MINUTES, 120),
  maxUploadBytes: num(process.env.MAX_UPLOAD_BYTES, 512 * 1024 * 1024),
  maxMediaSeconds: num(process.env.MAX_MEDIA_SECONDS, 4 * 60 * 60),
  maxConcurrentJobsPerSession: num(process.env.MAX_CONCURRENT_JOBS_PER_SESSION, 3),
  workerConcurrency: num(process.env.WORKER_CONCURRENCY, 2),
  ai: {
    provider: process.env.AI_PROVIDER ?? (process.env.OPENAI_API_KEY ? 'openai' : process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'none'),
    openaiKey: process.env.OPENAI_API_KEY ?? '',
    openaiBaseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    anthropicKey: process.env.ANTHROPIC_API_KEY ?? '',
    anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-3-5-sonnet-latest',
    maxInputChars: num(process.env.AI_MAX_INPUT_CHARS, 120_000),
  },
  transcription: {
    provider: process.env.TRANSCRIPTION_PROVIDER ?? (process.env.DEEPGRAM_API_KEY ? 'deepgram' : process.env.OPENAI_API_KEY ? 'openai' : 'none'),
    deepgramKey: process.env.DEEPGRAM_API_KEY ?? '',
    deepgramModel: process.env.DEEPGRAM_MODEL ?? 'nova-2',
    openaiKey: process.env.OPENAI_API_KEY ?? '',
    openaiBaseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    openaiModel: process.env.OPENAI_TRANSCRIBE_MODEL ?? 'whisper-1',
  },
  urlIngest: {
    enabled: (process.env.URL_INGEST_ENABLED ?? 'true') !== 'false',
    ytdlpPath: process.env.YTDLP_PATH ?? 'yt-dlp',
  },
};

export type Config = typeof config;
