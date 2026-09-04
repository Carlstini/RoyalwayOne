# Environment variables

Every variable Royalway One reads, what it does, and whether it is required.

> **Secrets rule:** provider API keys are read **only** by the server process.
> They are never bundled into the frontend, never returned by any API, and never
> committed to the repository. In `render.yaml` they are declared `sync: false`,
> which means Render prompts for them in the dashboard and keeps them out of git.
> The browser only ever learns a *boolean* (`ai: true/false`) from
> `GET /api/capabilities` — never a key.

---

## Quick answer: what must I set on Render?

| Variable name | Required? | Set where |
|---|---|---|
| `OPENAI_API_KEY` | Required for AI **and** transcription | Render dashboard → `royalway-one` → Environment |
| `DEEPGRAM_API_KEY` | Optional — better speaker diarization | Render dashboard → `royalway-one` → Environment |
| `ANTHROPIC_API_KEY` | Optional — alternative to OpenAI | Render dashboard → `royalway-one` → Environment |

Everything else in this document is already set for you by `render.yaml`,
including `SESSION_SECRET` and `ADMIN_TOKEN`, which Render generates.

There is a **single service**, so provider keys are configured in exactly one
place. (If you later split out a dedicated worker service — which requires
migrating to shared object storage — that worker needs the *same* provider keys,
because it is the process that runs transcription and long AI jobs.)

**Never put a key value in `render.yaml`, `.env.example`, or any tracked file.**

---

## Required in production

| Variable | Example | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Enables production logging and strict framing. |
| `PORT` | `8080` | Render injects this automatically. |
| `SESSION_SECRET` | 32+ random chars | Signs anonymous session cookies **and** download links. Rotating it invalidates existing download links. Use `generateValue: true`. |
| `STORAGE_DIR` | `/var/data` | Must point at a mounted persistent disk. Uploads, outputs and temp files live here. |

## Strongly recommended

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | *(none)* | Postgres connection string. Without it the server falls back to a local JSON store, which is fine for a single instance. Required if you ever run a separate worker process, since the two must share one queue. |
| `ADMIN_TOKEN` | *(none)* | Enables `/admin`. **While unset, every admin endpoint returns 404** — the dashboard simply does not exist. |
| `PUBLIC_URL` | *(none)* | Canonical origin, used for sitemap/SEO URLs. |

---

## AI provider (powers the AI Workspace, Business Tools, Ask Document, Compare)

Set **one** of the following. If none is set, AI tools honestly report themselves
as unavailable instead of pretending to work.

### Option A — OpenAI (recommended: one key also covers transcription)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `OPENAI_API_KEY` | **yes** | — | `sk-...`. Server-side only. |
| `OPENAI_MODEL` | no | `gpt-4o-mini` | Any chat-completions model. |
| `OPENAI_BASE_URL` | no | `https://api.openai.com/v1` | Point at Azure OpenAI, a gateway, or an egress proxy. |
| `OPENAI_EMBEDDING_MODEL` | no | `text-embedding-3-small` | Used for Ask Document retrieval. |

### Option B — Anthropic

| Variable | Required | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | **yes** | — |
| `ANTHROPIC_MODEL` | no | `claude-3-5-sonnet-latest` |

### Shared AI settings

| Variable | Default | Notes |
|---|---|---|
| `AI_PROVIDER` | auto-detected | Force `openai` or `anthropic` when both keys exist. |
| `AI_MAX_INPUT_CHARS` | `120000` | Longer documents are truncated before sending, and the UI says so. |

---

## Transcription provider (powers Transcribe + AI-dependent meeting workflows)

Set **one**. If none is set, transcription reports itself as unavailable.

### Option A — Deepgram (best speaker diarization and word timings)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DEEPGRAM_API_KEY` | **yes** | — | Server-side only. |
| `DEEPGRAM_MODEL` | no | `nova-2` | |
| `DEEPGRAM_BASE_URL` | no | `https://api.deepgram.com` | For Deepgram on-prem or an egress proxy. |

### Option B — OpenAI Whisper

Reuses `OPENAI_API_KEY`. Long recordings are automatically split into
10-minute chunks and stitched back together with corrected timestamps.

| Variable | Default |
|---|---|
| `OPENAI_TRANSCRIBE_MODEL` | `whisper-1` |

| Variable | Default | Notes |
|---|---|---|
| `TRANSCRIPTION_PROVIDER` | auto-detected | Force `deepgram` or `openai`. |

**Which to choose:** one `OPENAI_API_KEY` switches on *everything*. Add
`DEEPGRAM_API_KEY` as well if you want better speaker labels on meetings.

---

## Limits, retention and safety

| Variable | Default | Notes |
|---|---|---|
| `FILE_RETENTION_MINUTES` | `120` | Files are deleted this long after upload. The Privacy page shows the live value. |
| `MAX_UPLOAD_BYTES` | `536870912` (512 MB) | Per-file upload cap. |
| `MAX_MEDIA_SECONDS` | `14400` (4 h) | Rejects longer audio/video before processing. |
| `MAX_CONCURRENT_JOBS_PER_SESSION` | `3` | Anti-abuse, per anonymous session. |
| `WORKER_CONCURRENCY` | `2` | Heavy jobs processed in parallel. Raise only with more CPU/RAM. |
| `RUN_WORKER` | `true` | Whether this process also drains the job queue. Keep `true` on Render: the single web service owns the persistent disk and must process its own jobs. Set `false` only if a separate worker service runs against **shared object storage** (see DEPLOYMENT.md). |
| `FRAME_ANCESTORS` | `'self'` in production | CSP `frame-ancestors`. Widen only if you intentionally embed the app. |
| `URL_INGEST_ENABLED` | `true` | Allows transcribing a public media URL. SSRF-protected: private/loopback ranges are blocked. |
| `YTDLP_PATH` | `yt-dlp` | Optional. Enables platform URLs where permitted; direct media links work without it. |

## Diagnostics and advanced

| Variable | Default | Notes |
|---|---|---|
| `LOG_LEVEL` | `info` in production, `debug` otherwise | Pino level: `trace`, `debug`, `info`, `warn`, `error`, `fatal`. File contents are never logged at any level. |
| `CORS_ORIGINS` | *(empty)* | Comma-separated origin allow-list. Leave unset for the normal single-origin deployment, where the SPA and API share an origin and no CORS is needed. |
| `TESSERACT_LANG_PATH` | `${STORAGE_DIR}/tessdata` | Directory holding OCR language data. Override to point at a pre-seeded cache. |

## Optional binaries

| Variable | Default | Notes |
|---|---|---|
| `FFMPEG_PATH` / `FFPROBE_PATH` | bundled | Bundled via `@ffmpeg-installer` / `@ffprobe-installer`; override to use a system build. |
| `SOFFICE_PATH` | auto-detected | If LibreOffice is present, Office↔PDF conversions use it for higher fidelity. Without it, library-based fallbacks are used and everything still works. |

---

## Local development

Create `server/.env` (already gitignored — never commit it):

```bash
NODE_ENV=development
PORT=8080
SESSION_SECRET=local-dev-secret-change-me
STORAGE_DIR=./.storage

# Optional: switch on AI + transcription locally
OPENAI_API_KEY=sk-your-key-here
# DEEPGRAM_API_KEY=your-deepgram-key
```

Then:

```bash
npm install
npm run dev
```

Check what is actually enabled at any time:

```bash
curl localhost:8080/api/health        # per-subsystem status
curl localhost:8080/api/capabilities  # booleans the frontend uses
```
