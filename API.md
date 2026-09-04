# API reference

Base path `/api`. All responses are JSON unless a file is returned.
Authentication is an anonymous session cookie set automatically on first
request — there are no user accounts and no user-supplied API keys.

**Error shape** (every failure, without exception):

```json
{ "ok": false, "error": { "code": "AI_TIMEOUT", "message": "The AI request took too long. Please try again with a shorter document." } }
```

Messages are written for end users. Stack traces and internal detail are logged
server-side, never returned.

---

## System

### `GET /api/health`
Liveness and per-subsystem status. Used as the Render health check.

```json
{ "ok": true, "status": "healthy", "version": "1.0.0", "uptimeSeconds": 412,
  "checks": { "database": {"status":"ok","detail":"postgres"},
              "media": {"status":"ok","detail":"ffmpeg"},
              "ai": {"status":"ok","detail":"openai"},
              "transcription": {"status":"ok","detail":"deepgram"} } }
```

`status` is `healthy` or `degraded`. Unconfigured optional providers make a
check `degraded` but never bring the service down.

### `GET /api/capabilities`
What the frontend uses to decide what to show. **Returns booleans only — never a key.**

```json
{ "ok": true, "ai": true, "transcription": true,
  "urlPlatformSupport": false, "officeConversion": false,
  "limits": { "maxUploadBytes": 536870912, "maxMediaSeconds": 14400, "retentionMinutes": 120 } }
```

---

## Tools

### `GET /api/tools`
The full registry: categories, tools (with declarative field definitions),
workflows and capability booleans.

### `GET /api/tools/search?q=compress`
Ranked search across names, descriptions and keywords.

### `POST /api/tools/run`

```json
{ "toolId": "pdf-compress", "fileIds": ["<id>"], "params": { "preset": "recommended" } }
```

Light tools respond `200` with the result inline:

```json
{ "ok": true, "mode": "sync",
  "result": { "outputs": [ { "fileId": "...", "name": "report-compressed.pdf",
                             "size": 184320, "mime": "application/pdf",
                             "downloadUrl": "/api/files/...?exp=...&sig=..." } ],
              "stats": { "originalSize": 1840000, "newSize": 184320, "saved": "90%" } } }
```

Heavy tools respond `202`:

```json
{ "ok": true, "mode": "job", "job": { "id": "<jobId>", "status": "queued" } }
```

### `GET /api/jobs/:id`
Poll a queued job. `status` is `queued` → `running` (with a human `stage`) →
`succeeded` (with `result`) or `failed` (with a friendly `error`).

### `POST /api/workflows/run`
`{ "workflowId": "meeting-workflow", "fileIds": ["<id>"] }` → always a job.
The result contains a `steps[]` array; each step reports `succeeded`,
`skipped` or `failed` with its own outputs, so a partial run is still useful.

---

## Files

### `POST /api/upload`
`multipart/form-data`, field `files`, up to 40 files. Content type is sniffed
from magic bytes; executables are rejected with `415`.

### `GET /api/files/:id?exp=<ts>&sig=<hmac>`
Returns the file. The signature is `HMAC-SHA256(SESSION_SECRET, "<id>.<exp>")`.
Owning the session also authorises access. `?download=0` serves inline.

### `GET /api/files/:id/pages?limit=5&dpi=96`
PDF page previews for the signing and redaction editors: a base64 JPEG plus both
pixel and **PDF point** dimensions, so the browser can map clicks to exact
coordinates.

---

## AI

All AI endpoints return `503 AI_NOT_CONFIGURED` when no provider key is set.

### `POST /api/ai/:task`
Tasks: `summarize`, `executive-summary`, `key-points`, `action-items`,
`decisions`, `topics`, `questions`, `meeting-minutes`, `follow-up-email`,
`explain`, `important-moments`, `swot`, `presentation-outline`, `project-brief`,
`decision-log`, `proposal-analysis`, `policy-summary`, `document-review`,
`job-description`, `report-summary`.

Body: `{ "fileId": "..." }` or `{ "text": "..." }`, plus optional `instruction`.
Response: `{ "ok": true, "task": "...", "output": "<markdown>", "truncated": false }`.

### `POST /api/ai/extract`
Structured extraction. Returns JSON fields and items rather than prose.

### `POST /api/ai/compare`
`{ "fileIds": ["a","b"] }` → a measured line-level diff (`added`, `removed`,
similarity) **plus** an AI narrative. The diff is computed locally, so the
figures are real even if the narrative is unavailable.

### `POST /api/ai/chat`
Grounded retrieval chat over one document or transcript.

```json
{ "fileId": "...", "question": "What are the deadlines?", "history": [] }
```

Returns `{ "answer": "...", "sources": [ { "label": "Page 2", "excerpt": "..." } ] }`.
The model is instructed to answer only from the retrieved context and to say so
when the document does not contain the answer.

---

## Transcription

Return `503 TRANSCRIPTION_NOT_CONFIGURED` when no provider key is set.

### `POST /api/transcription`
`{ "fileId": "...", "language": "", "diarize": true, "analyse": true }` → a job.
The result contains `transcriptId`, `text`, `segments[]` (with `start`, `end`,
`speaker`), `language`, `durationSeconds` and optional AI `analysis`.

### `POST /api/transcription/url`
`{ "url": "https://..." }`. SSRF-protected: private, loopback and link-local
addresses are blocked.

### `GET /api/transcription/:id` · `PUT /api/transcription/:id`
Fetch or save an edited transcript. Edits are reflected in later exports.

### `GET /api/transcription/:id/export/:format`
`txt` · `docx` · `pdf` · `srt` · `vtt` · `md`. Optional `?timestamps=0`.

---

## Admin

**Every admin route returns `404` while `ADMIN_TOKEN` is unset** — the dashboard
does not exist unless deliberately enabled. Authenticate with the
`x-admin-token` header; comparison is timing-safe.

- `GET /api/admin/overview` — system, providers, job stats, storage, usage counts
- `POST /api/admin/cleanup` — force removal of expired files

---

## Analytics

`POST /api/analytics/event` accepts a strict allow-list of event names
(`tool_opened`, `category_opened`, `search_performed`, `download_clicked`,
`intro_seen`, `workflow_opened`). No file names, contents, IP addresses or
identifiers are stored.

---

## Error codes

| Code | Meaning |
|---|---|
| `BAD_REQUEST` | Invalid input; the message says what to fix |
| `UNSUPPORTED_TYPE` | File type not accepted |
| `FILE_TOO_LARGE` / `PAYLOAD_TOO_LARGE` | Over the configured limit |
| `NOT_FOUND` | Unknown or expired resource |
| `LINK_EXPIRED` | Download signature expired |
| `RATE_LIMITED` | Too many requests |
| `TOO_MANY_JOBS` | Session job limit reached |
| `EMPTY` / `NO_TEXT` | Nothing readable in the document |
| `AI_NOT_CONFIGURED` | No AI provider key |
| `AI_BUSY` / `AI_FAILED` / `AI_TIMEOUT` | Provider unavailable, failed or too slow |
| `TRANSCRIPTION_NOT_CONFIGURED` | No transcription key |
| `TRANSCRIPTION_BUSY` / `TRANSCRIPTION_FAILED` / `TRANSCRIPTION_TIMEOUT` | Provider problem |
| `NO_SPEECH` | No speech detected |
| `URL_BLOCKED` / `URL_UNREACHABLE` / `URL_UNSUPPORTED` | Media URL rejected |
| `INTERNAL` | Unexpected server error |
