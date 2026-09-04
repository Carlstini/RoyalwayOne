# Deploying Royalway One to Render

> **Status of provider verification:** the application has been fully tested
> locally against a protocol-level contract harness, but **it has not yet been
> run against a live AI/transcription provider, and it has not yet been
> deployed to Render.** Both steps are pending and require real credentials
> that must be supplied by the deployer. Nothing in this document should be
> read as a claim that real-provider operation has been verified.

---

## 1. What gets created

The `render.yaml` blueprint defines exactly **two** resources:

| Resource | Type | Purpose |
|---|---|---|
| `royalway-one` | Web service (Node, plan `standard`) | Serves the API and the built frontend, and processes queued jobs in-process |
| `royalway-db` | PostgreSQL 16 (plan `basic-256mb`) | Job and event bookkeeping |

Plus one **20 GB persistent disk** mounted at `/var/data` on the web service.

### Why there is no separate worker service

Royalway One writes uploads, intermediate artefacts and outputs to a persistent
disk. Render's disks are **accessible by only a single service instance** — a
second service cannot mount the same disk.

A separate background worker would therefore be unable to read files uploaded
through the web service, and every heavy job (OCR, transcription, video
encoding) would fail with *"One of your files is no longer available."*
**This was verified experimentally, not assumed.**

So the web service runs the job worker in-process (`RUN_WORKER=true`). Jobs are
still queued and processed asynchronously with bounded concurrency
(`WORKER_CONCURRENCY`), and HTTP requests never block on them.

A dedicated worker entrypoint (`npm run worker --workspace server`) exists and
is ready for the day storage moves to a shared object store (S3/R2). Do **not**
enable it while the blueprint uses a disk.

---

## 2. Deploy from GitHub

1. Push this repository to GitHub.
2. In the Render dashboard: **New +** → **Blueprint**.
3. Connect the repository and select the branch.
4. Render reads `render.yaml` and lists the resources it will create.
5. Click **Apply**.

`SESSION_SECRET` and `ADMIN_TOKEN` are generated automatically by Render.
Anything marked `sync: false` is left blank for you to fill in — that is step 3.

The first deploy will **succeed and be fully healthy without any provider
keys**. AI and transcription simply report themselves as unavailable until you
add them.

---

## 3. Add provider credentials

**This is the step that switches AI and transcription on.** Until it is done,
the AI Workspace, Business Tools and Transcription pages honestly display
*"not switched on for this deployment"*.

1. Open the **`royalway-one`** service → **Environment**.
2. Add the variable(s) below.
3. **Save changes** — this triggers a redeploy.

| Variable name | Switches on |
|---|---|
| `OPENAI_API_KEY` | All AI tools, Document AI, Ask Document, Compare, AI workflows — **and** transcription via Whisper |
| `DEEPGRAM_API_KEY` | Transcription with better speaker diarization (optional if `OPENAI_API_KEY` is set) |
| `ANTHROPIC_API_KEY` | Alternative AI provider instead of OpenAI |

**A single `OPENAI_API_KEY` is enough to switch on every AI and transcription
feature in the product.**

### Which services need the keys?

**Only `royalway-one`.** There is one service, and it runs both the API and the
job worker, so there is nowhere else to configure them.

> If you later split out a separate worker service (which requires migrating to
> shared object storage first), that worker **must** receive the same
> `OPENAI_API_KEY` / `DEEPGRAM_API_KEY` / `ANTHROPIC_API_KEY` values as the web
> service, because it is the process that executes transcription and long AI
> jobs.

### Credential handling

- Keys are read **only** by the server process.
- They are never bundled into frontend code, never returned by any API
  response, and never written to logs.
- They are declared `sync: false` in `render.yaml`, so Render prompts for them
  in the dashboard and never reads them from git.
- The browser only ever learns booleans (`{"ai": true}`) from
  `GET /api/capabilities`.
- **No API key value appears anywhere in this repository.**

---

## 4. Verify the deployment

### Step 1 — health

```bash
curl https://YOUR-APP.onrender.com/api/health
```

Expect HTTP `200` and `"status": "healthy"`. Each subsystem is listed
individually. Unconfigured providers show as `degraded`, which is expected and
does **not** fail the health check or block the deploy.

### Step 2 — capabilities

```bash
curl https://YOUR-APP.onrender.com/api/capabilities
```

After adding keys, expect:

```json
{"ok":true,"ai":true,"transcription":true, ...}
```

If either is still `false`:

- confirm the variable name is exact (`OPENAI_API_KEY`, not `OPENAI_KEY`);
- confirm the redeploy finished after saving;
- check **Logs** for `ai: not configured` at boot.

### Step 3 — real browser checklist

Work through this as an ordinary anonymous visitor:

1. **Home** — the welcome animation plays once, then the workspace loads.
2. **`/pdf/compress`** — upload a real PDF, choose *Recommended*, confirm a
   genuinely smaller file downloads and the reported saving matches the file.
3. **`/pdf/merge`** — merge two PDFs, confirm the page count of the result.
4. **`/image/compress`** — upload a photo, confirm real size reduction.
5. **`/transcribe`** — upload a real recording. Confirm a genuine transcript
   with timestamps and speaker labels, edit a line, search it, then export
   **TXT, SRT, VTT, DOCX and PDF** and open each file.
6. **`/ai/document-chat`** — upload a real document and ask a question whose
   answer is in it. Confirm the answer is grounded and cites excerpts. Then ask
   something **not** in the document and confirm it says so instead of
   inventing an answer.
7. **`/ai/summarize`** — upload a document, confirm the summary reflects the
   actual content, and that copy/download work.
8. **`/ai/compare`** — compare two versions, confirm the real differences.
9. **`/workflows`** — run a workflow end to end.
10. **`/admin`** — enter `ADMIN_TOKEN` (Render → Environment) and confirm both
    providers show as configured.
11. **Mobile** — load the site on a phone width; confirm no horizontal scroll.

Only when every step passes with real files is the deployment complete.

---

## 5. Operations

**Scaling.** Use `standard` or larger. `sharp`, `mupdf` and FFmpeg are
memory-hungry and `starter` will OOM on large files. A service with a disk
attached **cannot be scaled to multiple instances** — increase instance size
rather than count. Raise `WORKER_CONCURRENCY` only alongside more CPU/RAM.

**Deploys have brief downtime.** Attaching a disk disables zero-downtime
deploys: Render stops the old instance before starting the new one. This is a
safeguard against two versions writing to one disk.

**Database migrations.** The schema (`jobs`, `events`) is created idempotently
at boot with `CREATE TABLE IF NOT EXISTS`. There is no separate migration step
and no migration command to run. Verified against a completely empty database.

**Storage.** Files live under `STORAGE_DIR` (`/var/data`) and are deleted
automatically after `FILE_RETENTION_MINUTES` (default 120). Only data under the
mount path survives a redeploy.

**Rollback.** Service → **Deploys** → **Rollback**. Schema changes are additive
and idempotent, so an app rollback needs no database rollback.

**Custom domain.** Add it under **Settings → Custom Domain**, then set
`PUBLIC_URL` to the final origin so canonical URLs and `sitemap.xml` are
correct.
