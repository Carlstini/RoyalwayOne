# Deploying Royalway One to Render

The repository ships a `render.yaml` blueprint: a web service, a background
worker, a Postgres database and a shared persistent disk.

---

## 1. Deploy the blueprint

1. Push this repository to GitHub.
2. In Render: **New +** → **Blueprint** → select the repository.
3. Render reads `render.yaml` and shows the resources it will create.
4. Click **Apply**.

`SESSION_SECRET` and `ADMIN_TOKEN` are generated automatically. Everything
marked `sync: false` is left blank for you to fill in — that is step 2.

## 2. Add provider credentials (this is what switches AI on)

**Until you do this, the AI Workspace, Business Tools and Transcription pages
will correctly display "not switched on for this deployment".** That is the
honest fallback, not a bug — but it is not the intended shipping state.

For **each** of `royalway-one` (web) and `royalway-worker`:

1. Open the service → **Environment**.
2. Add the keys below → **Save changes** (this redeploys the service).

| Key | Value | Switches on |
|---|---|---|
| `OPENAI_API_KEY` | `sk-...` | All 26 AI/Business tools, Ask Document, Compare, **and** transcription via Whisper |
| `DEEPGRAM_API_KEY` | your Deepgram key | Transcription with better speaker diarization (optional if you set the OpenAI key) |

> **The worker needs the same keys as the web service.** The worker executes the
> heavy queued jobs — transcription and long AI runs — so if only the web service
> has keys, those jobs will fail.

A single `OPENAI_API_KEY` on both services is enough to switch on every feature.

Keys are server-side only. They are never sent to the browser: the frontend
learns nothing but `{"ai": true, "transcription": true}` from
`GET /api/capabilities`.

## 3. Verify the deployment

```bash
# 1. Health — every subsystem should be "ok"
curl https://YOUR-APP.onrender.com/api/health

# 2. Capabilities — both must be true once keys are set
curl https://YOUR-APP.onrender.com/api/capabilities
# {"ok":true,"ai":true,"transcription":true,...}
```

If `ai` or `transcription` is still `false`:

- confirm the variable name is exact (`OPENAI_API_KEY`, not `OPENAI_KEY`);
- confirm you saved on **both** services and the redeploy finished;
- check **Logs** for `ai: not configured`.

Then, in a browser:

1. Open the site — the welcome animation plays once.
2. `/pdf/compress` — upload a PDF, confirm a genuinely smaller file downloads.
3. `/transcribe` — upload a recording, confirm a real transcript with
   timestamps, then export SRT and DOCX.
4. `/ai/document-chat` — upload a document, ask "what are the deadlines?" and
   confirm the answer cites content from *your* document.
5. `/admin` — enter `ADMIN_TOKEN` (Render dashboard → Environment) and confirm
   both providers show as configured.

## 4. Scaling notes

- **Plan:** `standard` or higher. `sharp`, `mupdf` and FFmpeg are memory-hungry;
  `starter` will OOM on large files.
- **Disk:** the web service and worker each mount a disk at `/var/data`. Files
  are removed automatically after `FILE_RETENTION_MINUTES`.
- **Single-service option:** delete the `royalway-worker` block and set
  `RUN_WORKER=true` on the web service. Simpler and cheaper; heavy jobs then
  compete with request handling.
- **Concurrency:** raise `WORKER_CONCURRENCY` only alongside more CPU/RAM.

## 5. Database and migrations

Schema is created idempotently on boot (`jobs`, `events`) — there is no separate
migration step. Without `DATABASE_URL` the server uses a local JSON store; that
works for a single instance but a **separate worker service requires Postgres**
so both processes share one queue.

## 6. Rollback

Render keeps previous deploys: service → **Deploys** → **Rollback**. Because
schema changes are additive and idempotent, rolling the app back does not
require a database rollback.

## 7. Custom domain

Add it under **Settings → Custom Domain**, then set `PUBLIC_URL` to the final
origin so `sitemap.xml` and canonical URLs are correct.
