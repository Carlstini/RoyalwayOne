# Architecture

A **modular monolith**. One deployable server, one SPA, optional Postgres.
Deliberately no Kubernetes, Kafka, RabbitMQ, Celery or Redis — the job volume
does not justify them, and every added moving part is another thing that can
silently break.

In the shipped Render topology the server also runs the job worker in-process,
because the persistent disk holding uploads can only be mounted by one service.
See DEPLOYMENT.md for why a separate worker service would break file access.

```
┌──────────────┐   HTTPS    ┌─────────────────────────────┐
│   Browser    │ ─────────► │  Express (server/)          │
│  React SPA   │            │  ├── routes/    HTTP layer  │
└──────────────┘            │  ├── tools/     registry    │
                            │  ├── services/  real work   │
                            │  └── lib/       infra       │
                            └───────┬──────────┬──────────┘
                                    │          │
                            ┌───────▼───┐  ┌───▼─────────┐
                            │ Postgres  │  │ Disk        │
                            │ jobs,     │  │ uploads,    │
                            │ events    │  │ outputs,tmp │
                            └───────────┘  └─────────────┘
                                    ▲
                    (job worker runs in-process by default;
                     a standalone entrypoint exists for a future
                     shared-object-storage deployment)
```

## Layers

**`routes/`** — HTTP only: validate with zod, enforce rate limits, call a
service, shape the response. No business logic.

**`tools/`** — the registry. Every tool is one object:

```ts
{
  id: 'pdf-compress',
  category: 'pdf',
  route: '/pdf/compress',          // clean SEO URL
  accept: ['application/pdf'],
  minFiles: 1, maxFiles: 1,
  heavy: true,                     // queue it instead of running inline
  fields: [ /* declarative UI */ ],
  async run(ctx) { /* real work */ },
}
```

This single source of truth drives the API, navigation, search, category pages,
SEO routes and the sitemap. Adding a tool means adding one entry — nothing else
has to be kept in sync.

**`services/`** — where real processing happens: `pdf.ts` (mupdf + pdf-lib),
`media.ts` (FFmpeg), `ocr.ts` (Tesseract), `convert.ts`, `text-extract.ts`,
plus provider abstractions.

**`lib/`** — infrastructure: config, storage, signed URLs, sessions, job queue,
rate limiting, logging, errors.

## Provider abstractions

Four interfaces keep vendors swappable and make "not configured" a first-class,
honest state rather than a crash:

| Interface | Implementations |
|---|---|
| `AIProvider` | OpenAI, Anthropic |
| `TranscriptionProvider` | Deepgram, OpenAI Whisper |
| `MediaProcessor` | FFmpeg |
| `DocumentProcessor` | mupdf, pdf-lib, sharp, docx, xlsx |

Each exposes `isConfigured()`. `GET /api/capabilities` reports those booleans and
the UI adapts — which is why a missing key produces a clear message instead of a
broken button. Adding a provider means implementing the interface and
registering it; no feature code changes.

## Job model

Light tools run inline and return immediately. Tools marked `heavy: true`
(video encoding, OCR, transcription, long AI runs) are queued:

```
POST /api/tools/run → 202 { mode: 'job', job: { id } }
GET  /api/jobs/:id  → queued → running (+stage) → succeeded | failed
```

The client polls with backoff and shows the current stage. Stages are truthful:
where real progress cannot be measured, the bar is indeterminate rather than
faking a percentage.

With `DATABASE_URL`, jobs live in Postgres. Without it, an equivalent JSON store
backs the same interface — fine for a single instance.

By default the API process runs the worker loop itself (`RUN_WORKER=true`), so
queued jobs are processed with bounded concurrency without blocking requests.
A standalone worker entrypoint (`npm run worker --workspace server`) exists for
a future deployment backed by shared object storage; it requires `DATABASE_URL`
and storage both processes can reach.

## Storage and signed downloads

Files are stored outside the web root under `STORAGE_DIR`, keyed by a 32-hex id.
Downloads use `HMAC-SHA256(SESSION_SECRET, "<fileId>.<expiry>")`, so links expire
and cannot be guessed. A sweeper deletes expired files and temp artefacts on a
timer. Uploads are type-sniffed from magic bytes — the declared MIME type and
filename are never trusted.

## Frontend

React 19 + Vite. The registry is fetched once and cached in a workspace context
alongside the session's files, so a file uploaded for one tool can be reused by
another without re-uploading.

`ToolRunner` is a single component driving every standard tool: file selection,
declarative option fields, upload progress, job polling, error handling with
retry, and results. Tools needing direct manipulation — signing, redaction,
image cropping — have bespoke canvas editors that map pointer coordinates back
into true PDF points or image pixels.

## Why these choices

- **Modular monolith** — one deploy, one log stream, no distributed tracing
  needed to answer "why did this PDF fail?".
- **Registry-driven** — the alternative is duplicating tool metadata across
  routes, nav, search and sitemap, which drifts.
- **Postgres optional** — the app must run locally with zero infrastructure.
- **Provider abstractions** — the product must degrade honestly, not crash,
  when a key is absent.
